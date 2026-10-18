//! The login window.
//!
//! A plugin's `fetch` goes through the host's HTTP client, and that client has
//! a cookie jar — but a login page is JavaScript, a captcha, and a second
//! factor, which no `fetch` implementation can reproduce. So this is the one
//! place Rome hands a page to a real engine: a separate native window where the
//! user signs in the way they would in a browser, after which the cookies
//! WebKit collected are copied into the same jar the plugins read.
//!
//! The window is a GPUI window with a `WKWebView` attached as a child view,
//! not a second event loop. GPUI owns the main thread, and a `tao` loop on top
//! of it would be two run loops arguing over one thread; the webview only needs
//! the loop that is already running.
//!
//! Why a page at all, when a plugin may only ask for six semantic dialogs: a
//! login page is the one interaction that *is* a web page. "Ask for a password"
//! and "let the user log in" are different requests, and only the second one
//! can carry a captcha. Everything else a plugin asks for stays declarative so
//! that plugin interfaces look like Rome; this stays a window so that logging
//! in works at all.

use std::cell::RefCell;
use std::rc::Rc;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{ActiveTheme, h_flex, v_flex};
use gpui_kit::*;
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::{Rect, WebView, WebViewBuilder};

use crate::http::JarCookie;

/// The strip above the page: the reason this window exists, and the way out.
///
/// A login page cannot be trusted to offer a "done" button that means what the
/// host needs — many do not navigate anywhere when the login succeeds, they
/// just swap the page's own contents. A fixed strip the app owns is the only
/// part of this window whose meaning is ours.
const HEADER_HEIGHT: f32 = 44.0;

/// What to do once the window is done with.
type Done = Box<dyn FnOnce(bool, Vec<JarCookie>)>;

/// The window's state.
struct LoginView {
    url: String,
    title: String,
    webview: Option<WebView>,
    /// Why there is no page, when there is none.
    error: Option<String>,
    /// The last viewport the webview was laid out at.
    ///
    /// Wry creates the child view with a fixed frame on macOS — its autoresizing
    /// mask only holds the top margin — so a window resize has to be applied by
    /// hand. Rendering happens on resize, which is the cheapest place to
    /// notice.
    laid_out: Option<Size<Pixels>>,
    /// Taken by whichever path finishes first: the button, closing the window,
    /// or teardown. Whoever gets it answers the plugin exactly once.
    done: Rc<RefCell<Option<Done>>>,
}

/// Open `url` in a new window and call `on_done` when it closes.
///
/// `on_done` receives whether the user said they were finished, and the cookies
/// the page left behind. It is called exactly once, including when the window is
/// closed without the button — a plugin waiting on the answer must never be left
/// waiting.
pub fn open(
    url: String,
    cx: &mut App,
    on_done: impl FnOnce(bool, Vec<JarCookie>) + 'static,
) -> anyhow::Result<()> {
    let title = format!("登录 {}", host_of(&url));
    let done: Rc<RefCell<Option<Done>>> = Rc::new(RefCell::new(Some(Box::new(on_done))));
    let shown = title.clone();

    cx.open_window(
        WindowOptions {
            // Wide enough for a desktop site, tall enough to see a login form
            // above the fold without scrolling.
            window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                point(px(0.), px(0.)),
                size(px(980.), px(760.)),
            ))),
            titlebar: Some(TitlebarOptions {
                title: Some(shown.clone().into()),
                ..Default::default()
            }),
            ..Default::default()
        },
        move |window, cx| {
            let view = cx.new(|_| LoginView {
                url: url.clone(),
                title: shown.clone(),
                webview: None,
                error: None,
                laid_out: None,
                done: done.clone(),
            });

            view.update(cx, |view, cx| view.attach(window, cx));
            view
        },
    )?;

    Ok(())
}

impl LoginView {
    /// Put the webview over the body of the window.
    fn attach(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let bounds = self.webview_bounds(window);

        let builder = WebViewBuilder::new()
            .with_url(self.url.clone())
            .with_bounds(bounds);

        match builder.build_as_child(&*window) {
            Ok(webview) => {
                // Wry only calls `makeFirstResponder` for the non-child path,
                // and a login form that cannot receive keystrokes is useless.
                let _ = webview.focus();
                self.laid_out = Some(window.viewport_size());
                self.webview = Some(webview);
            }
            Err(error) => {
                self.error = Some(format!("网页控件没有创建成功：{error}"));
                cx.notify();
            }
        }
    }

    /// The rectangle the page occupies, in logical pixels.
    ///
    /// Wry treats these as logical and flips the Y axis itself, so the header
    /// is the top strip in the coordinates a layout would use.
    fn webview_bounds(&self, window: &Window) -> Rect {
        let viewport = window.viewport_size();
        let height = f32::from(viewport.height) - HEADER_HEIGHT;

        Rect {
            position: LogicalPosition::new(0., HEADER_HEIGHT).into(),
            size: LogicalSize::new(f32::from(viewport.width), height.max(0.)).into(),
        }
    }

    /// Collect what WebKit has stored and hand it to the jar.
    ///
    /// Every cookie in the window's store is imported, not only the ones for
    /// the page that was opened: a login that goes through an identity
    /// provider sets cookies on the provider's domain too, and those are
    /// exactly what a later request needs. The jar replaces by (domain, path,
    /// name), so re-importing is idempotent.
    fn harvest(&mut self) -> Vec<JarCookie> {
        let Some(webview) = self.webview.as_ref() else {
            return Vec::new();
        };

        match webview.cookies() {
            Ok(cookies) => cookies.iter().filter_map(jar_cookie).collect(),
            Err(error) => {
                self.error = Some(format!("读不到登录窗口的 cookie：{error}"));
                Vec::new()
            }
        }
    }

    /// Answer the plugin, once.
    fn finish(&mut self, finished: bool) {
        let done = self.done.borrow_mut().take();
        let Some(done) = done else {
            return;
        };

        let cookies = self.harvest();
        done(finished, cookies);
    }
}

impl Render for LoginView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let viewport = window.viewport_size();
        if self.laid_out != Some(viewport) {
            self.laid_out = Some(viewport);
            if let Some(webview) = self.webview.as_ref() {
                let _ = webview.set_bounds(self.webview_bounds(window));
            }
        }

        let theme = cx.theme();
        let border = theme.border;
        let dangerous = theme.danger;

        let done = cx.listener(|this, _, window, _cx| {
            this.finish(true);
            window.remove_window();
        });

        let header = h_flex()
            .h(px(HEADER_HEIGHT))
            .w_full()
            .flex_shrink_0()
            .px_3()
            .gap_2()
            .border_b_1()
            .border_color(border)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_sm()
                    .child(self.title.clone()),
            )
            .child(
                Button::new("login-done")
                    .primary()
                    .label("完成登录")
                    .on_click(done),
            );

        let external = self.url.clone();

        let body = match self.error.as_ref() {
            Some(message) => v_flex()
                .flex_1()
                .items_center()
                .justify_center()
                .gap_2()
                .child(div().text_sm().text_color(dangerous).child(message.clone()))
                // The page could not be shown, but the user can still log in
                // somewhere that works. Their browser's cookies stay in their
                // browser; this is a way out, not a fix.
                .child(
                    Button::new("login-open-external")
                        .ghost()
                        .label("在浏览器中打开")
                        .on_click(move |_, _, _| {
                            let _ = crate::open::url(&external);
                        }),
                )
                .into_any_element(),
            None => div().flex_1().into_any_element(),
        };

        v_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(header)
            .child(body)
    }
}

impl Drop for LoginView {
    fn drop(&mut self) {
        // Closing with the X still leaves the cookies the user collected; they
        // are kept. The plugin is told "not finished" because the user did not
        // say so, and a plugin that needs certainty can verify with a fetch.
        self.finish(false);
    }
}

/// The host a page lives on, for the window's title.
fn host_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| url.to_owned())
}

/// Convert one WebKit cookie into the jar's representation.
///
/// One field cannot be recovered: WebKit knows whether a cookie was host-only —
/// it marks a domain cookie with a leading dot on the domain — but the `cookie`
/// crate strips that dot in every accessor it offers, so the distinction is not
/// observable from here. Every cookie the login window collects is therefore
/// stored as a domain cookie.
///
/// The direction matters. Calling them all host-only instead would silently
/// drop the cookie an identity provider sets on the parent domain, which is
/// precisely the case a login window exists for. This way the cost is bounded:
/// a cookie is sent to subdomains of the domain it was set on, and never to
/// another site.
pub fn jar_cookie(cookie: &wry::cookie::Cookie<'static>) -> Option<JarCookie> {
    let name = cookie.name().to_owned();
    if name.is_empty() {
        return None;
    }

    let domain = cookie.domain().unwrap_or_default();
    if domain.is_empty() {
        return None;
    }

    Some(JarCookie {
        domain: domain.to_owned(),
        path: cookie.path().unwrap_or("/").to_owned(),
        name,
        value: cookie.value().to_owned(),
        host_only: false,
        expires_at: cookie.expires_datetime().map(|at| at.unix_timestamp()),
        secure: cookie.secure().unwrap_or(false),
        http_only: cookie.http_only().unwrap_or(false),
    })
}
