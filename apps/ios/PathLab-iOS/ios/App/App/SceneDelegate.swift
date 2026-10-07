import Capacitor
import Foundation
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        PathLabProjectOpenCoordinator.shared.capture(connectionOptions.urlContexts)
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = PathLabViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        PathLabProjectOpenCoordinator.shared.capture(URLContexts)
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Keeps document-open URLs available across cold launch, before Capacitor
/// instantiates the native plugin and JavaScript registers its listeners.
final class PathLabProjectOpenCoordinator {
    static let shared = PathLabProjectOpenCoordinator()

    private let lock = NSLock()
    private var pendingURLs: [URL] = []

    func capture(_ contexts: Set<UIOpenURLContext>) {
        let urls = contexts
            .compactMap { context in
                context.url.pathExtension.lowercased() == "pathlab" ? context.url : nil
            }
            .sorted { $0.absoluteString < $1.absoluteString }
        guard !urls.isEmpty else { return }

        lock.lock()
        pendingURLs.append(contentsOf: urls)
        lock.unlock()

        NotificationCenter.default.post(name: .pathLabExternalProjectURL, object: nil)
    }

    func takePendingURL() -> URL? {
        lock.lock()
        defer { lock.unlock() }
        guard !pendingURLs.isEmpty else { return nil }
        return pendingURLs.removeFirst()
    }
}

extension Notification.Name {
    static let pathLabExternalProjectURL = Notification.Name("PathLabExternalProjectURL")
}
