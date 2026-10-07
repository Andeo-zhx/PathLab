import Capacitor
import Foundation
import Security
import UIKit
import UniformTypeIdentifiers

@objc(PathLabNativePlugin)
public class PathLabNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PathLabNativePlugin"
    public let jsName = "PathLabNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "invoke", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickProject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeOpenedProject", returnType: CAPPluginReturnPromise),
    ]

    private let endpoint = URL(string: "https://api.deepseek.com/chat/completions")!
    private let model = "deepseek-flash"
    private let maximumCharacters = 12_000
    private var activeTask: URLSessionDataTask?
    private var activeRequestID: UUID?
    private var projectPickerCall: CAPPluginCall?
    private var isProcessingProjectURL = false
    private var pendingProjectResults: [[String: Any]] = []

    @objc override public func load() {
        super.load()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleOpenedProjectURL(_:)),
            name: .pathLabExternalProjectURL,
            object: nil
        )

        // SceneDelegate captures document URLs before the Capacitor bridge and
        // JavaScript listeners are ready. Drain that queue after observing it.
        processNextPendingProjectURL()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private var keychainQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Bundle.main.bundleIdentifier ?? "org.pathlab.mobile",
            kSecAttrAccount as String: "deepseek-translation-key",
        ]
    }

    @objc public func invoke(_ call: CAPPluginCall) {
        guard let request = call.getObject("request"), let operation = request["op"] as? String else {
            call.resolve(failure("invalid-request", "翻译请求无效。"))
            return
        }

        switch operation {
        case "status":
            do {
                call.resolve(["ok": true, "keyConfigured": try loadAPIKey() != nil])
            } catch {
                call.resolve(failure("keychain-error", "无法读取 iOS 钥匙串中的 API Key。"))
            }
        case "save-key":
            guard let key = request["key"] as? String, !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                call.resolve(failure("invalid-key", "请输入 DeepSeek API Key。"))
                return
            }
            do {
                try saveAPIKey(key.trimmingCharacters(in: .whitespacesAndNewlines))
                call.resolve(["ok": true, "keyConfigured": true])
            } catch {
                call.resolve(failure("keychain-error", "无法安全保存 API Key，请稍后重试。"))
            }
        case "delete-key":
            do {
                try deleteAPIKey()
                call.resolve(["ok": true, "keyConfigured": false])
            } catch {
                call.resolve(failure("keychain-error", "无法删除 iOS 钥匙串中的 API Key。"))
            }
        case "cancel":
            activeTask?.cancel()
            activeTask = nil
            activeRequestID = nil
            call.resolve(["ok": true, "cancelled": true])
        case "translate":
            translate(request, call: call)
        default:
            call.resolve(failure("unsupported-operation", "不支持此翻译操作。"))
        }
    }

    @objc public func pickProject(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.projectPickerCall == nil else {
                call.reject("文件选择器正在使用中，请稍后重试。")
                return
            }
            guard let viewController = self.bridge?.viewController else {
                call.reject("无法打开 iOS 文件选择器。")
                return
            }

            // Providers often report legacy .pathlab files as generic data.
            // Accept data here and validate the extension after selection.
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data], asCopy: true)
            picker.allowsMultipleSelection = false
            picker.delegate = self
            self.projectPickerCall = call
            viewController.present(picker, animated: true)
        }
    }

    @objc public func consumeOpenedProject(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.pendingProjectResults.isEmpty else {
                call.resolve(["cancelled": true])
                self.processNextPendingProjectURL()
                return
            }
            let result = self.pendingProjectResults.removeFirst()
            call.resolve(result)
            self.processNextPendingProjectURL()
        }
    }

    @objc private func handleOpenedProjectURL(_ notification: Notification) {
        processNextPendingProjectURL()
    }

    private func processNextPendingProjectURL() {
        DispatchQueue.main.async {
            guard !self.isProcessingProjectURL,
                  self.pendingProjectResults.isEmpty,
                  let url = PathLabProjectOpenCoordinator.shared.takePendingURL()
            else { return }

            self.isProcessingProjectURL = true
            DispatchQueue.global(qos: .userInitiated).async {
                let result: [String: Any]
                let eventName: String
                do {
                    result = try self.copyProjectToCache(url)
                    eventName = "projectOpened"
                } catch {
                    result = [
                        "failed": true,
                        "message": "无法从“文件”读取工程：\(error.localizedDescription)",
                    ]
                    eventName = "projectOpenFailed"
                }

                DispatchQueue.main.async {
                    self.isProcessingProjectURL = false
                    self.pendingProjectResults.append(result)
                    self.notifyListeners(eventName, data: result)
                }
            }
        }
    }

    private func copyPickedProject(_ sourceURL: URL, call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let project = try self.copyProjectToCache(sourceURL)

                DispatchQueue.main.async {
                    call.resolve(project)
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject("无法复制所选工程文件：\(error.localizedDescription)")
                }
            }
        }
    }

    private func copyProjectToCache(_ sourceURL: URL) throws -> [String: String] {
        let didStartAccessing = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if didStartAccessing {
                sourceURL.stopAccessingSecurityScopedResource()
            }
        }

        let cacheRoot = try FileManager.default.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let importDirectory = cacheRoot.appendingPathComponent("PathLabImports", isDirectory: true)
        try FileManager.default.createDirectory(at: importDirectory, withIntermediateDirectories: true)

        let fileName = sourceURL.lastPathComponent
        let copiedURL = importDirectory.appendingPathComponent("\(UUID().uuidString)-\(fileName)")
        var coordinationError: NSError?
        var copyError: Error?
        NSFileCoordinator(filePresenter: nil).coordinate(
            readingItemAt: sourceURL,
            options: .withoutChanges,
            error: &coordinationError
        ) { coordinatedURL in
            do {
                try FileManager.default.copyItem(at: coordinatedURL, to: copiedURL)
            } catch {
                copyError = error
            }
        }
        if let coordinationError {
            try? FileManager.default.removeItem(at: copiedURL)
            throw coordinationError
        }
        if let copyError {
            try? FileManager.default.removeItem(at: copiedURL)
            throw copyError
        }
        return [
            "relativePath": "PathLabImports/\(copiedURL.lastPathComponent)",
            "fileName": fileName,
        ]
    }

    private func translate(_ request: [String: Any], call: CAPPluginCall) {
        guard let text = request["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.resolve(failure("empty-text", "标注文字为空，无法翻译。"))
            return
        }
        guard text.count <= maximumCharacters else {
            call.resolve(failure("text-too-long", "单条标注最多支持 \(maximumCharacters) 个字符。"))
            return
        }
        guard let target = request["targetLanguage"] as? String, ["zh", "en"].contains(target) else {
            call.resolve(failure("invalid-language", "目标语言设置无效。"))
            return
        }
        let apiKey: String
        do {
            guard let storedKey = try loadAPIKey(), !storedKey.isEmpty else {
                call.resolve(failure("missing-key", "请先添加 DeepSeek API Key。"))
                return
            }
            apiKey = storedKey
        } catch {
            call.resolve(failure("keychain-error", "无法读取 iOS 钥匙串中的 API Key。"))
            return
        }

        let language = target == "en" ? "English" : "Chinese"
        let systemPrompt = "Translate into \(language). Preserve meaning, pathology and medical terminology, abbreviations, Latin species names, numbers, and line breaks. Return only the translation, without explanations, alternatives, or Markdown."
        let payload: [String: Any] = [
            "model": model,
            "messages": [
                ["role": "system", "content": systemPrompt],
                ["role": "user", "content": text],
            ],
            "thinking": ["type": "disabled"],
            "max_tokens": 2048,
        ]

        var urlRequest = URLRequest(url: endpoint)
        urlRequest.httpMethod = "POST"
        urlRequest.timeoutInterval = 60
        urlRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            urlRequest.httpBody = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            call.resolve(failure("request-error", "无法准备翻译请求。"))
            return
        }

        activeTask?.cancel()
        let requestID = UUID()
        activeRequestID = requestID
        let task = URLSession.shared.dataTask(with: urlRequest) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if self.activeRequestID == requestID {
                    self.activeTask = nil
                    self.activeRequestID = nil
                }
                if let urlError = error as? URLError, urlError.code == .cancelled {
                    call.resolve(["ok": true, "cancelled": true])
                    return
                }
                if let error {
                    call.resolve(self.failure("network-error", "连接 DeepSeek 失败：\(error.localizedDescription)"))
                    return
                }
                guard let http = response as? HTTPURLResponse, let data else {
                    call.resolve(self.failure("network-error", "DeepSeek 未返回有效响应。"))
                    return
                }
                guard (200..<300).contains(http.statusCode) else {
                    let message = self.apiErrorMessage(data) ?? "HTTP \(http.statusCode)"
                    call.resolve(self.failure("api-error", "DeepSeek 翻译失败：\(message)"))
                    return
                }
                do {
                    let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                    let choices = root?["choices"] as? [[String: Any]]
                    let message = choices?.first?["message"] as? [String: Any]
                    let translated = (message?["content"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard let translated, !translated.isEmpty else {
                        call.resolve(self.failure("empty-response", "DeepSeek 没有返回译文。"))
                        return
                    }
                    // Only `message.content` is surfaced; reasoning fields are never displayed.
                    call.resolve(["ok": true, "text": translated])
                } catch {
                    call.resolve(self.failure("invalid-response", "无法解析 DeepSeek 的翻译结果。"))
                }
            }
        }
        activeTask = task
        task.resume()
    }

    private func apiErrorMessage(_ data: Data) -> String? {
        guard
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let error = root["error"] as? [String: Any]
        else { return nil }
        return error["message"] as? String
    }

    private func failure(_ code: String, _ message: String) -> [String: Any] {
        ["ok": false, "code": code, "message": message]
    }

    private func loadAPIKey() throws -> String? {
        var query = keychainQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data, let key = String(data: data, encoding: .utf8) else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
        return key
    }

    private func saveAPIKey(_ key: String) throws {
        let query = keychainQuery
        let attributes: [String: Any] = [
            kSecValueData as String: Data(key.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
        var item = query
        attributes.forEach { item[$0.key] = $0.value }
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus))
        }
    }

    private func deleteAPIKey() throws {
        let status = SecItemDelete(keychainQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }
}

extension PathLabNativePlugin: UIDocumentPickerDelegate {
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = projectPickerCall else { return }
        projectPickerCall = nil
        guard let sourceURL = urls.first else {
            call.resolve(["cancelled": true])
            return
        }
        guard sourceURL.pathExtension.lowercased() == "pathlab" else {
            call.reject("请选择 PathLab 导出的 .pathlab 工程文件。")
            return
        }
        copyPickedProject(sourceURL, call: call)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        let call = projectPickerCall
        projectPickerCall = nil
        call?.resolve(["cancelled": true])
    }
}
