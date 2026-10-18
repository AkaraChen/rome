//! Turning a plugin's HTML into the blocks the reading pane draws.
//!
//! This is a tag stripper, not a parser, and it stays that way on purpose. The
//! alternative is an HTML parser dependency in a program whose whole position
//! is that it does not run an engine: the interesting part of a feed entry is
//! the prose, and a real parse would buy formatting nobody asked for in
//! exchange for a dependency and a new class of bug. What the stripper does
//! keep is the structure a reader actually uses — where paragraphs end, which
//! lines were headings or list items, where a block of code begins — plus the
//! two things prose cannot express as text: images and links.
//!
//! Nothing here knows about GPUI. That is what makes it testable from
//! `tests/content.rs`, and it is why the rendering file can stay a mapping from
//! [`Block`] to an element.
//!
//! [`article`] is the one function here that is handed a document rather than a
//! fragment, and it exists for the entries that arrive without one — see its
//! own note.

/// One piece of an entry's text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Block {
    Paragraph(String),
    /// A line that was a heading in the original, drawn larger.
    Heading(String),
    /// A line that was a list item.
    Bullet(String),
    Quote(String),
    /// A `<pre>` block. Whitespace and line breaks are part of the content
    /// here, unlike in prose, because a code listing means what its columns
    /// say.
    Code(String),
    /// An image the content itself carried, by URL.
    ///
    /// The reading pane renders these in place. Whether the first one is
    /// already the article's hero image is decided at draw time, where the
    /// hero is known; the stripper has no business choosing a layout.
    Image(String),
    /// A horizontal rule, which in a feed is usually a section break.
    Divider,
}

/// A link the content carried.
///
/// Collected beside the blocks rather than inside them. Making each paragraph
/// carry styled, clickable spans would need per-span hit boxes, which GPUI does
/// not expose on a plain text element; the honest low-cost version is the
/// anchor's text left in the prose and a compact list of its destinations at
/// the foot of the article. See [`usable_links`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    /// The `href` as written, before resolution against the entry's URL.
    pub url: String,
    /// The anchor's visible text, cleaned; empty when the anchor held only an
    /// image or whitespace.
    pub text: String,
}

/// Everything the reading pane needs from one chunk of HTML.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Parsed {
    pub blocks: Vec<Block>,
    pub links: Vec<Link>,
}

/// Break a plugin's HTML into blocks and links.
pub fn parse(html: &str) -> Parsed {
    let mut parser = Parser {
        html,
        at: 0,
        out: Vec::new(),
        current: String::new(),
        heading: false,
        bullet: false,
        quote: false,
        pre: None,
        links: Vec::new(),
        link: None,
    };

    parser.run();

    Parsed {
        blocks: parser.out,
        links: parser.links,
    }
}

/// The blocks alone, for callers that do not need the link list.
pub fn blocks(html: &str) -> Vec<Block> {
    parse(html).blocks
}

/// The entry's text as plain text, for the clipboard.
///
/// Block boundaries become blank lines and list markers survive, because a
/// copy that ran every paragraph together would be a transcript, not the
/// article. An image contributes its URL: dropping it entirely would silently
/// lose a thing the reader might want to open, and inventing alt text is worse
/// than the address itself.
pub fn plain_text(blocks: &[Block]) -> String {
    let mut out = String::new();

    for block in blocks {
        if !out.is_empty() {
            out.push_str("\n\n");
        }

        match block {
            Block::Paragraph(text) | Block::Heading(text) => out.push_str(text),
            Block::Bullet(text) => {
                out.push_str("• ");
                out.push_str(text);
            }
            Block::Quote(text) => {
                out.push_str("> ");
                out.push_str(text);
            }
            Block::Code(text) => out.push_str(text),
            Block::Image(url) => out.push_str(url),
            Block::Divider => out.push_str("---"),
        }
    }

    out
}

/// The fewest non-whitespace characters a region needs before it counts as an
/// article.
///
/// Two hundred is about a paragraph. Below it the page had no story in it — a
/// login wall, a video, a redirect notice — and the reader is better served by
/// the summary the plugin already had than by a scrap of somebody's sidebar.
const MIN_ARTICLE_CHARS: usize = 200;

/// How much of a page's article is kept, in bytes.
///
/// A cap rather than a limit anyone should meet: a cleaned article runs to tens
/// of kilobytes. It is here because the fetched body is allowed to be eight
/// mebibytes and this text goes in the database, where an outlier page would
/// cost every future read of the entry.
const MAX_ARTICLE_BYTES: usize = 512 * 1024;

/// The elements whose contents are a page's furniture rather than its prose.
///
/// Dropped whole, contents and all. `script` and `style` are here because what
/// they contain is code; the rest because a reader mode that showed the cookie
/// banner, the newsletter box and the share row would be worse than no reader
/// mode. `header` and `footer` are on the list even inside an `<article>`,
/// where they are the byline and the buttons — the reading pane draws its own.
///
/// Every one of these has contents. A void element must never be added: the
/// scan for a closing tag would run to the end of the document and take the
/// article with it.
const FURNITURE: &[&str] = &[
    "head", "script", "style", "noscript", "template", "svg", "iframe", "canvas", "nav", "aside",
    "footer", "header", "form", "button", "select", "textarea", "label", "dialog", "menu",
];

/// The main body of a fetched page, as HTML [`parse`] can read.
///
/// This is what makes a link aggregator readable. Hacker News knows a story's
/// title and its address and nothing about what is behind it, so the host goes
/// and reads the page itself — but a page is not an article, and handing the
/// whole document to the stripper would put the navigation and the footer in
/// the middle of the prose. What this keeps is the region the page nominated
/// itself: its `<article>`, or its `<main>`, with the furniture inside dropped.
///
/// It is a scan rather than a parse, for the reason the rest of this module is:
/// the page is somebody else's markup, none of it is trusted, and a reader that
/// runs no engine should not be the one place a hostile document gets an
/// engine's worth of attention. The cost is that a page nominating neither
/// element falls back to its `<body>` with the furniture removed, which is
/// worse than a browser's reader mode would manage and better than nothing.
///
/// `None` when there is no article in the page. The caller keeps what it had.
pub fn article(html: &str) -> Option<String> {
    let (start, end) = region(html);
    let cleaned = strip(&html[start..end]);

    let text = plain_text(&blocks(&cleaned));
    let letters = text.chars().filter(|c| !c.is_whitespace()).count();

    (letters >= MIN_ARTICLE_CHARS).then(|| truncate(cleaned, MAX_ARTICLE_BYTES))
}

/// The span of the page's own idea of its content.
///
/// `<article>` and `<main>` are the two elements HTML5 added for exactly this,
/// and a page that uses either has already said where its content is.
/// `<article>` is tried first and kept whole even when a `<main>` encloses it:
/// the two nest the other way round far more often than not. A page with an
/// `<article>` has it as its story, and the `<main>` around it is that story
/// plus whatever the site put beside it — a share row, a comment box, a list of
/// what to read next.
fn region(html: &str) -> (usize, usize) {
    element_span(html, "article")
        .or_else(|| element_span(html, "main"))
        .or_else(|| element_span(html, "body"))
        // No body at all means the caller handed over a fragment. Everything
        // in it is the region.
        .unwrap_or((0, html.len()))
}

/// The inside of the first `name` element: from just past its opening tag to
/// just before its closing one, or to the end of the document when it never
/// closes — which is what a browser does with an unclosed element too.
///
/// Nesting is counted rather than assumed. `<article>` inside `<article>` is
/// legal, and stopping at the first `</article>` would cut the outer one short.
fn element_span(html: &str, name: &str) -> Option<(usize, usize)> {
    let mut search = 0;
    let mut start = None;
    let mut depth = 0usize;

    while let Some(offset) = html[search..].find('<') {
        let at = search + offset;

        let Some((tag, next)) = tag_at(html, at) else {
            // A `<` that is prose. The byte after it is a character boundary
            // because `<` is one byte.
            search = at + 1;
            continue;
        };

        search = next;

        // A script is not markup, whatever it looks like. Its contents are
        // skipped rather than scanned: a template string holding `</article>`
        // would otherwise close an element that was still open.
        if is_raw_element(&tag.name) {
            if !tag.closing {
                search = skip_element(html, next, &tag.name);
            }
            continue;
        }

        if tag.name != name {
            continue;
        }

        if tag.closing {
            if depth == 0 {
                continue;
            }

            depth -= 1;

            if depth == 0 {
                return start.map(|start| (start, at));
            }
        } else {
            // Only the outermost opening tag sets the start; the ones after it
            // are counted, not recorded.
            start.get_or_insert(next);
            depth += 1;
        }
    }

    start.map(|start| (start, html.len()))
}

/// Drop every element in [`FURNITURE`], and every comment, from a region.
///
/// Everything else is copied through as it was, so the stripper still sees the
/// paragraph and heading boundaries it uses to lay the text out.
fn strip(region: &str) -> String {
    let mut out = String::with_capacity(region.len());
    let mut at = 0;

    while at < region.len() {
        let rest = &region[at..];

        if let Some(comment) = rest.strip_prefix("<!--") {
            match comment.find("-->") {
                Some(end) => at += 4 + end + 3,
                None => break,
            }
            continue;
        }

        if rest.starts_with('<') {
            if let Some((tag, next)) = tag_at(region, at) {
                if !tag.closing && FURNITURE.contains(&tag.name.as_str()) {
                    at = skip_element(region, next, &tag.name);
                    continue;
                }

                out.push_str(&region[at..next]);
                at = next;
                continue;
            }

            out.push('<');
            at += 1;
            continue;
        }

        let c = rest.chars().next().expect("not at the end");
        out.push(c);
        at += c.len_utf8();
    }

    out
}

/// `text` cut to at most `limit` bytes, at a tag boundary.
///
/// The cut lands after the last complete tag before the limit, because half a
/// tag is not markup: a truncated `<a href="https://exa` reaches the stripper
/// as an anchor whose address is half a URL, and a truncated `<p` as the
/// literal text of a comparison.
fn truncate(mut text: String, limit: usize) -> String {
    if text.len() <= limit {
        return text;
    }

    let mut end = limit;

    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }

    if let Some(at) = text[..end].rfind('>') {
        end = at + 1;
    }

    text.truncate(end);
    text
}

/// Resolve a link against the entry's own URL and keep only the ones a browser
/// should be handed.
///
/// Feeds are inconsistent about relative hrefs, so the common shapes are
/// resolved here rather than dropped: `/path`, `path`, `//host/path`.
/// Everything that is not `http(s)` — `mailto:`, `javascript:`, a fragment —
/// is discarded, both because [`crate::open::url`] would refuse it anyway and
/// because a link list full of things that cannot open is noise. A link back
/// to the article itself is left out too: the toolbar already has "open in
/// browser" for that.
pub fn usable_links(links: &[Link], base: Option<&str>) -> Vec<Link> {
    let base_without_fragment = base.map(|base| base.split('#').next().unwrap_or(base));
    let mut out: Vec<Link> = Vec::new();

    for link in links {
        let Some(url) = resolve(base, &link.url) else {
            continue;
        };

        if Some(url.as_str()) == base_without_fragment {
            continue;
        }

        if let Some(existing) = out.iter_mut().find(|existing| existing.url == url) {
            // The same destination linked twice: the first anchor text is the
            // better label, but an empty one (an image link) should yield to a
            // later one that says where it goes.
            if existing.text.is_empty() {
                existing.text = link.text.clone();
            }
        } else {
            out.push(Link {
                url,
                text: link.text.clone(),
            });
        }
    }

    out
}

/// The URL an image block should load, or `None` when it is not something the
/// image element can fetch.
///
/// Data URLs are kept because a feed that inline-encodes a small image is
/// giving us the bytes already; everything else must resolve to `http(s)`.
pub fn image_url(base: Option<&str>, raw: &str) -> Option<String> {
    let raw = raw.trim();

    if raw.is_empty() {
        return None;
    }

    if raw.starts_with("data:image/") {
        return Some(raw.to_owned());
    }

    resolve(base, raw)
}

/// Turn `href` into an absolute URL, or `None` if that is not possible or not
/// something the app opens.
fn resolve(base: Option<&str>, href: &str) -> Option<String> {
    let href = href.trim();

    // A bare fragment points inside the page we are already reading.
    if href.is_empty() || href.starts_with('#') {
        return None;
    }

    if href.starts_with("http://") || href.starts_with("https://") {
        return Some(href.to_owned());
    }

    // Protocol-relative: feeds use these when they mirror the site's own TLS
    // choice. There is no page context to inherit, so https is the only sane
    // guess.
    if href.starts_with("//") {
        return Some(format!("https:{href}"));
    }

    // Any other scheme (`mailto:`, `javascript:`, `data:`) is not ours to
    // open. A colon before the first slash is what makes it a scheme; `a:b`
    // in a path is legal and must not be mistaken for one.
    if let Some(colon) = href.find(':')
        && href[..colon]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return None;
    }

    let base = base?;
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return None;
    }

    // The article's own query string and fragment are not part of its path.
    let base = base.split(['#', '?']).next().unwrap_or(base);
    let scheme_end = base.find("://")? + 3;
    let authority_end = base[scheme_end..]
        .find('/')
        .map_or(base.len(), |at| scheme_end + at);

    if href.starts_with('/') {
        return Some(format!("{}{href}", &base[..authority_end]));
    }

    // A relative href replaces the last path segment, the way a browser
    // resolves it. A base with no path at all gets a slash inserted so the
    // result is still a URL rather than `https://hostimg.png`.
    let dir_end = match base[authority_end..].rfind('/') {
        Some(at) => authority_end + at + 1,
        None => authority_end,
    };
    let separator = if dir_end == authority_end && !base.ends_with('/') {
        "/"
    } else {
        ""
    };

    Some(format!("{}{separator}{href}", &base[..dir_end]))
}

/// The markdown a title can be handed to GPUI's selectable text view as.
///
/// GPUI exposes text selection through its rich-text element, which parses
/// Markdown. The title is plain text, so every ASCII punctuation character is
/// backslash-escaped: CommonMark removes the backslash and shows the character
/// the author wrote, while no `*`, `_`, `[` or backtick can turn a headline
/// into formatting. Newlines become spaces because a title is one line.
pub fn escape_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());

    for c in text.chars() {
        match c {
            '\n' | '\r' => out.push(' '),
            c if c.is_ascii_punctuation() => {
                out.push('\\');
                out.push(c);
            }
            c => out.push(c),
        }
    }

    out
}

/// The scanner's whole state.
struct Parser<'a> {
    html: &'a str,
    at: usize,
    out: Vec<Block>,
    /// Text accumulated for the block being built.
    current: String,
    heading: bool,
    bullet: bool,
    quote: bool,
    /// `Some` while inside `<pre>`; the code text, whitespace intact.
    pre: Option<String>,
    links: Vec<Link>,
    /// An `<a>` whose closing tag has not been seen yet.
    link: Option<PendingLink>,
}

struct PendingLink {
    url: String,
    /// Where the anchor's text starts in `current`.
    start: usize,
}

/// One tag, as much of it as the stripper cares about.
struct Tag<'a> {
    /// Lowercased element name; empty for declarations and comments.
    name: String,
    closing: bool,
    /// Everything after the name, for attribute lookup.
    attrs: &'a str,
}

impl Parser<'_> {
    fn run(&mut self) {
        while self.at < self.html.len() {
            if self.pre.is_some() {
                self.pre_step();
                continue;
            }

            let rest = &self.html[self.at..];

            if rest.starts_with('<') {
                if rest.starts_with("<!--") {
                    self.skip_comment();
                    continue;
                }

                if let Some((tag, next)) = tag_at(self.html, self.at) {
                    self.at = next;
                    self.handle(tag);
                    continue;
                }

                // A `<` that does not start a tag is prose: "a < b" is a
                // comparison, not the beginning of markup.
                self.current.push('<');
                self.at += 1;
                continue;
            }

            let c = rest.chars().next().expect("not at the end");
            self.current.push(c);
            self.at += c.len_utf8();
        }

        if self.pre.is_some() {
            self.end_pre();
        } else {
            self.flush();
        }
    }

    /// One step inside `<pre>`.
    ///
    /// Tags are dropped but their text is not, so `<pre><code>…</code></pre>`
    /// keeps the code. `<br>` is a line break because that is the only way a
    /// preformatted block says "newline" without an actual newline.
    fn pre_step(&mut self) {
        let rest = &self.html[self.at..];

        if rest.starts_with("<!--") {
            self.skip_comment();
            return;
        }

        if rest.starts_with('<')
            && let Some((tag, next)) = tag_at(self.html, self.at)
        {
            self.at = next;

            if tag.name == "pre" && tag.closing {
                self.end_pre();
            } else if tag.name == "br" {
                self.pre.as_mut().expect("inside pre").push('\n');
            }

            return;
        }

        let c = rest.chars().next().expect("not at the end");
        self.pre.as_mut().expect("inside pre").push(c);
        self.at += c.len_utf8();
    }

    fn skip_comment(&mut self) {
        match self.html[self.at + 4..].find("-->") {
            Some(end) => self.at += 4 + end + 3,
            None => self.at = self.html.len(),
        }
    }

    fn handle(&mut self, tag: Tag<'_>) {
        let name = tag.name.as_str();

        if name.is_empty() {
            return;
        }

        // Elements whose content is not prose. The opening tag was already
        // consumed, so the scanner jumps to the closing one.
        if !tag.closing && is_raw_element(name) {
            self.at = skip_element(self.html, self.at, name);
            return;
        }

        match name {
            "pre" if tag.closing => self.end_pre(),
            "pre" => {
                self.flush();
                self.pre = Some(String::new());
            }

            // Outside `<pre>` a break ends the paragraph; inside one it was
            // handled above, where it must survive as a newline.
            "br" => self.flush(),

            "hr" => {
                self.flush();
                self.out.push(Block::Divider);
            }

            "img" if !tag.closing => self.image(tag.attrs),

            "a" if tag.closing => self.finish_link(),
            "a" => {
                if let Some(href) = attr(tag.attrs, "href") {
                    self.finish_link();
                    self.link = Some(PendingLink {
                        url: href,
                        start: self.current.len(),
                    });
                }
            }

            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                self.flush();
                self.heading = !tag.closing;
            }
            "li" => {
                self.flush();
                self.bullet = !tag.closing;
            }
            "blockquote" => {
                self.flush();
                self.quote = !tag.closing;
            }

            // Cells are separated by a space so a row does not run its columns
            // together into one word. They are not blocks: a table row reads as
            // one line of text here, which is already a compromise.
            "td" | "th" if tag.closing => self.current.push(' '),

            // A `<code>` outside `<pre>` is a word in a sentence — `cargo
            // build` inside a paragraph — so it stays prose. Only a whole
            // block of it earns the code treatment, because inline styling
            // would need the per-span hit boxes this stripper does not
            // produce and the pane cannot draw.
            "code" => {}

            _ if is_block(name) => self.flush(),

            _ => {}
        }
    }

    fn image(&mut self, attrs: &str) {
        let Some(src) =
            attr(attrs, "src").or_else(|| attr(attrs, "srcset").and_then(|set| first_srcset(&set)))
        else {
            return;
        };

        // An image inside a link is the anchor's payload; ending the anchor
        // here records the destination even though there was no text for it.
        self.finish_link();
        self.flush();
        self.out.push(Block::Image(src));
    }

    fn end_pre(&mut self) {
        let Some(raw) = self.pre.take() else {
            return;
        };

        let code = clean_code(&raw);
        if !code.is_empty() {
            self.out.push(Block::Code(code));
        }
    }

    /// Turn whatever has accumulated into a block, if it says anything.
    fn flush(&mut self) {
        self.finish_link();

        let text = clean(&self.current);
        self.current.clear();

        if text.is_empty() {
            return;
        }

        self.out.push(if self.heading {
            Block::Heading(text)
        } else if self.bullet {
            Block::Bullet(text)
        } else if self.quote {
            Block::Quote(text)
        } else {
            Block::Paragraph(text)
        });
    }

    /// Record the anchor that is open, if any, using its text so far.
    fn finish_link(&mut self) {
        let Some(pending) = self.link.take() else {
            return;
        };

        let text = if pending.start <= self.current.len() {
            clean(&self.current[pending.start..])
        } else {
            String::new()
        };

        if let Some(existing) = self.links.iter_mut().find(|link| link.url == pending.url) {
            if existing.text.is_empty() {
                existing.text = text;
            }
        } else {
            self.links.push(Link {
                url: pending.url,
                text,
            });
        }
    }
}

fn is_block(name: &str) -> bool {
    matches!(
        name,
        "p" | "div"
            | "section"
            | "article"
            | "header"
            | "footer"
            | "main"
            | "aside"
            | "nav"
            | "address"
            | "center"
            | "tr"
            | "table"
            | "thead"
            | "tbody"
            | "tfoot"
            | "caption"
            | "ul"
            | "ol"
            | "dl"
            | "dt"
            | "dd"
            | "figure"
            | "figcaption"
            | "form"
            | "fieldset"
            | "details"
            | "summary"
    )
}

fn is_raw_element(name: &str) -> bool {
    matches!(
        name,
        "script" | "style" | "head" | "noscript" | "iframe" | "svg" | "template" | "select"
    )
}

/// Find the end of the tag beginning at `at`, skipping `>` inside quoted
/// attribute values.
fn tag_end(html: &str, at: usize) -> Option<usize> {
    let mut quote = None;

    for (offset, c) in html[at..].char_indices() {
        match c {
            '"' | '\'' if quote.is_none() => quote = Some(c),
            c if Some(c) == quote => quote = None,
            '>' if quote.is_none() => return Some(at + offset),
            _ => {}
        }
    }

    None
}

/// Read the tag at `at`, or `None` when the `<` is prose rather than markup.
fn tag_at(html: &str, at: usize) -> Option<(Tag<'_>, usize)> {
    debug_assert!(html[at..].starts_with('<'));

    let end = tag_end(html, at)?;
    let inner = html[at + 1..end].trim();

    if inner.starts_with('!') || inner.starts_with('?') {
        return Some((
            Tag {
                name: String::new(),
                closing: false,
                attrs: "",
            },
            end + 1,
        ));
    }

    let (closing, body) = match inner.strip_prefix('/') {
        Some(body) => (true, body.trim_start()),
        None => (false, inner),
    };

    let name_len = body
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .unwrap_or(body.len());

    // `< 3` and `<3` are comparisons, not elements. A real tag name starts
    // with a letter.
    if name_len == 0 || !body.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }

    Some((
        Tag {
            name: body[..name_len].to_ascii_lowercase(),
            closing,
            attrs: &body[name_len..],
        },
        end + 1,
    ))
}

/// Jump past `</name>`; the end of the document if it never closes.
fn skip_element(html: &str, from: usize, name: &str) -> usize {
    let needle = format!("</{name}");
    let haystack = html[from..].to_ascii_lowercase();

    let Some(at) = haystack.find(&needle) else {
        return html.len();
    };

    let start = from + at;
    match tag_end(html, start) {
        Some(end) => end + 1,
        None => html.len(),
    }
}

/// Read one attribute value from a tag's remaining text.
fn attr(attrs: &str, wanted: &str) -> Option<String> {
    let mut at = 0;

    while at < attrs.len() {
        // Separators between attributes.
        while at < attrs.len() {
            let c = attrs[at..].chars().next().expect("in bounds");
            if c.is_ascii_whitespace() || c == '/' {
                at += c.len_utf8();
            } else {
                break;
            }
        }

        let key_start = at;
        while at < attrs.len() {
            let c = attrs[at..].chars().next().expect("in bounds");
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.') {
                at += c.len_utf8();
            } else {
                break;
            }
        }

        if at == key_start {
            // Stray punctuation. Step over one character so the scan always
            // makes progress.
            let c = attrs[at..].chars().next().expect("in bounds");
            at += c.len_utf8();
            continue;
        }

        let key = &attrs[key_start..at];

        while at < attrs.len() {
            let c = attrs[at..].chars().next().expect("in bounds");
            if c.is_ascii_whitespace() {
                at += c.len_utf8();
            } else {
                break;
            }
        }

        if at >= attrs.len() || !attrs[at..].starts_with('=') {
            // A boolean attribute; keep looking.
            continue;
        }
        at += 1;

        while at < attrs.len() {
            let c = attrs[at..].chars().next().expect("in bounds");
            if c.is_ascii_whitespace() {
                at += c.len_utf8();
            } else {
                break;
            }
        }

        if at >= attrs.len() {
            break;
        }

        let value = if attrs[at..].starts_with(['"', '\'']) {
            let quote = attrs[at..].chars().next().expect("in bounds");
            at += quote.len_utf8();
            let start = at;
            let end = attrs[start..]
                .find(quote)
                .map_or(attrs.len(), |offset| start + offset);
            at = (end + 1).min(attrs.len());
            &attrs[start..end]
        } else {
            let start = at;
            while at < attrs.len() {
                let c = attrs[at..].chars().next().expect("in bounds");
                if c.is_ascii_whitespace() {
                    break;
                }
                at += c.len_utf8();
            }
            &attrs[start..at]
        };

        if key.eq_ignore_ascii_case(wanted) {
            let value = decode_entities(value);
            let value = value.trim();

            if !value.is_empty() {
                return Some(value.to_owned());
            }
        }
    }

    None
}

/// The first candidate out of a `srcset`, which is `url [descriptor], …`.
fn first_srcset(value: &str) -> Option<String> {
    value
        .split(',')
        .next()?
        .split_whitespace()
        .next()
        .filter(|url| !url.is_empty())
        .map(str::to_owned)
}

/// Strip entities, collapse whitespace, and trim.
fn clean(raw: &str) -> String {
    decode_entities(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Clean a preformatted block without destroying what makes it preformatted.
///
/// The HTML spec says one newline immediately after `<pre>` is not content, so
/// it is dropped. Everything else — indentation, blank lines, the trailing
/// spaces that align a comment — survives. Tabs become spaces because a tab
/// stop depends on the renderer, and a code listing that shifts because the
/// text system guessed a different tab width is worse than one that was
/// converted consistently.
fn clean_code(raw: &str) -> String {
    let decoded = decode_entities(raw);
    let normalized = decoded
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\t', "    ");

    normalized
        .strip_prefix('\n')
        .unwrap_or(&normalized)
        .trim_end()
        .to_owned()
}

/// The entities that actually turn up in feeds.
///
/// A plugin's `content` is prose that was escaped once on the way into HTML.
/// Anything rarer than a non-breaking space survives as its source form, which
/// is ugly but legible — and much better than refusing to render.
fn decode_entities(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;

    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];

        let Some(end) = rest.find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };

        // An entity is short. A `;` further away than this is a semicolon in
        // the prose, not the end of a character reference.
        if end > 10 {
            out.push('&');
            rest = &rest[1..];
            continue;
        }

        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" | "#160" => Some(' '),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "hellip" => Some('…'),
            "rsquo" => Some('’'),
            "lsquo" => Some('‘'),
            "ldquo" => Some('“'),
            "rdquo" => Some('”'),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|dec| dec.parse().ok()))
                .and_then(char::from_u32),
        };

        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                // Not an entity after all. Keep the `&` and carry on from the
                // character after it, so `a & b` is not eaten.
                out.push('&');
                rest = &rest[1..];
            }
        }
    }

    out.push_str(rest);
    out
}
