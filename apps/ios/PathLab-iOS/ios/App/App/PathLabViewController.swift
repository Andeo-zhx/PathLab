import Capacitor

class PathLabViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        if let scrollView = webView?.scrollView {
            // Safe areas are applied by app.css. Keep native WKWebView geometry aligned
            // with CSS so Pencil, touch, and canvas hit testing share one origin.
            scrollView.contentInsetAdjustmentBehavior = .never
            scrollView.contentInset = .zero
            scrollView.scrollIndicatorInsets = .zero
            scrollView.bounces = false
        }
        bridge?.registerPluginInstance(PathLabNativePlugin())
    }
}
