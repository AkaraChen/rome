//! Handing a URL to whatever the user reads the web with.
//!
//! Rome makes no network requests of its own — it is a local program with no
//! service behind it — but the user clicking "open in browser" is the user
//! asking their own browser to fetch a page, which is a different thing and is
//! the entire point of a reader with a link in it.

use std::io;
use std::process::Command;

/// Open `url` in the user's default browser.
///
/// Fire-and-forget: the browser is a separate program and this returns as soon
/// as it has been asked to start. A failure here is almost always "there is no
/// browser registered", which the user will notice on their own.
pub fn url(url: &str) -> io::Result<()> {
    // Only http(s). A plugin controls what goes in an entry's `url`, and a
    // `file://` or an `smb://` handed to the system opener is a way to launch
    // something the reader did not ask for.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "only http(s) links are opened",
        ));
    }

    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(url);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command.spawn().map(drop)
}

/// Reveal a file in the system's file manager.
///
/// Used for "where is my data", which is the other half of being a local
/// program: the database and the plugins are files the user owns, and a
/// settings row that opens the folder is cheaper than documentation.
pub fn reveal(path: &std::path::Path) -> io::Result<()> {
    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(path);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command.spawn().map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_links_are_opened() {
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "smb://host/share",
            "not a url",
        ] {
            assert!(url(bad).is_err(), "{bad} should be refused");
        }
    }
}
