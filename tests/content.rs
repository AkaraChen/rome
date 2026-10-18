//! The reading pane's HTML stripper, tested from outside the crate.
//!
//! `content` is deliberately free of GPUI, so these cover the decisions that
//! would otherwise only be visible by eye: what survives the strip, what turns
//! into a block, and which links are safe and useful to offer back.

use rome::ui::content::{self, Block, Link};

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

#[test]
fn code_blocks_keep_their_shape() {
    assert_eq!(
        content::blocks(
            "<p>Before</p><pre><code>fn main() {\n    let x = 1;\n}</code></pre><p>After</p>"
        ),
        vec![
            Block::Paragraph("Before".to_owned()),
            Block::Code("fn main() {\n    let x = 1;\n}".to_owned()),
            Block::Paragraph("After".to_owned()),
        ]
    );
}

#[test]
fn a_br_inside_pre_is_a_newline() {
    assert_eq!(
        content::blocks("<pre>one<br>two<br/>three</pre>"),
        vec![Block::Code("one\ntwo\nthree".to_owned())]
    );
}

#[test]
fn one_leading_newline_after_pre_is_dropped() {
    // The HTML spec says that newline belongs to the tag, not the code.
    assert_eq!(
        content::blocks("<pre>\nfn main() {}</pre>"),
        vec![Block::Code("fn main() {}".to_owned())]
    );
}

#[test]
fn tabs_become_spaces_in_code() {
    assert_eq!(
        content::blocks("<pre>a\tb</pre>"),
        vec![Block::Code("a    b".to_owned())]
    );
}

#[test]
fn entities_are_decoded_in_code() {
    assert_eq!(
        content::blocks("<pre>a &lt; b &amp;&amp; c</pre>"),
        vec![Block::Code("a < b && c".to_owned())]
    );
}

#[test]
fn a_divider_is_a_block() {
    assert_eq!(
        content::blocks("<p>One</p><hr><p>Two</p>"),
        vec![
            Block::Paragraph("One".to_owned()),
            Block::Divider,
            Block::Paragraph("Two".to_owned()),
        ]
    );
}

#[test]
fn inline_code_joins_the_prose() {
    assert_eq!(
        content::blocks("<p>Run <code>cargo build</code> now.</p>"),
        vec![Block::Paragraph("Run cargo build now.".to_owned())]
    );
}

#[test]
fn images_become_blocks() {
    assert_eq!(
        content::blocks(r#"<p>x</p><img src="https://example.com/x.png" alt="y"><p>z</p>"#),
        vec![
            Block::Paragraph("x".to_owned()),
            Block::Image("https://example.com/x.png".to_owned()),
            Block::Paragraph("z".to_owned()),
        ]
    );
}

#[test]
fn a_srcset_first_candidate_is_used_when_src_is_absent() {
    assert_eq!(
        content::blocks(
            r#"<img srcset="https://example.com/small.png 1x, https://example.com/large.png 2x">"#
        ),
        vec![Block::Image("https://example.com/small.png".to_owned())]
    );
}

#[test]
fn paragraphs_nested_in_divs_do_not_make_empty_blocks() {
    assert_eq!(
        content::blocks("<div><p>One</p><p>Two</p></div>"),
        vec![
            Block::Paragraph("One".to_owned()),
            Block::Paragraph("Two".to_owned()),
        ]
    );

    assert_eq!(
        content::blocks("<div><p></p>text</div>"),
        vec![Block::Paragraph("text".to_owned())]
    );
}

#[test]
fn comments_are_dropped() {
    assert_eq!(
        content::blocks("a<!-- not prose -->b"),
        vec![Block::Paragraph("ab".to_owned())]
    );
}

#[test]
fn raw_elements_are_dropped_whole() {
    assert_eq!(
        content::blocks(r#"<script>var x = "<p>";</script><p>ok</p>"#),
        vec![Block::Paragraph("ok".to_owned())]
    );

    assert_eq!(
        content::blocks("<svg><text>icon</text></svg><p>ok</p>"),
        vec![Block::Paragraph("ok".to_owned())]
    );
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

#[test]
fn links_are_collected_with_their_text() {
    let parsed = content::parse(
        r#"<p>See <a href="https://example.com/a?x=1&amp;y=2">this</a> and <a href="/local">that</a>.</p>"#,
    );

    assert_eq!(
        parsed.links,
        vec![
            Link {
                url: "https://example.com/a?x=1&y=2".to_owned(),
                text: "this".to_owned(),
            },
            Link {
                url: "/local".to_owned(),
                text: "that".to_owned(),
            },
        ]
    );

    assert_eq!(
        parsed.blocks,
        vec![Block::Paragraph("See this and that.".to_owned())]
    );
}

#[test]
fn links_resolve_against_the_entry_url() {
    let parsed = content::parse(
        r#"<a href="/root">a</a><a href="sub/page">b</a><a href="//cdn.example.com/x">c</a>"#,
    );

    assert_eq!(
        content::usable_links(&parsed.links, Some("https://example.com/post/1")),
        vec![
            Link {
                url: "https://example.com/root".to_owned(),
                text: "a".to_owned(),
            },
            Link {
                url: "https://example.com/post/sub/page".to_owned(),
                text: "b".to_owned(),
            },
            Link {
                url: "https://cdn.example.com/x".to_owned(),
                text: "c".to_owned(),
            },
        ]
    );
}

#[test]
fn a_base_without_a_path_resolves_like_a_directory() {
    assert_eq!(
        content::image_url(Some("https://example.com"), "img.png").as_deref(),
        Some("https://example.com/img.png")
    );
    assert_eq!(
        content::image_url(Some("https://example.com/post"), "img.png").as_deref(),
        Some("https://example.com/img.png")
    );
    assert_eq!(
        content::image_url(Some("https://example.com/post/"), "img.png").as_deref(),
        Some("https://example.com/post/img.png")
    );
}

#[test]
fn non_http_links_are_dropped() {
    let parsed = content::parse(
        r##"<a href="mailto:a@b.c">m</a><a href="javascript:alert(1)">j</a><a href="#section">f</a>"##,
    );

    assert!(content::usable_links(&parsed.links, Some("https://example.com/")).is_empty());
}

#[test]
fn a_relative_link_without_a_base_is_dropped() {
    let parsed = content::parse(r#"<a href="/x">x</a>"#);

    assert!(content::usable_links(&parsed.links, None).is_empty());
}

#[test]
fn a_link_to_the_article_itself_is_left_out() {
    let parsed = content::parse(
        r#"<a href="https://example.com/p/1">self</a><a href="https://example.com/x">other</a>"#,
    );

    let links = content::usable_links(&parsed.links, Some("https://example.com/p/1"));

    assert_eq!(
        links,
        vec![Link {
            url: "https://example.com/x".to_owned(),
            text: "other".to_owned(),
        }]
    );
}

#[test]
fn duplicate_links_collapse_and_prefer_a_label() {
    let parsed = content::parse(
        r#"<a href="https://example.com/x"></a><a href="https://example.com/x">label</a>"#,
    );

    let links = content::usable_links(&parsed.links, None);

    assert_eq!(
        links,
        vec![Link {
            url: "https://example.com/x".to_owned(),
            text: "label".to_owned(),
        }]
    );
}

#[test]
fn image_urls_reject_what_the_image_element_cannot_fetch() {
    assert_eq!(content::image_url(None, "javascript:alert(1)"), None);
    assert_eq!(
        content::image_url(None, "data:image/gif;base64,AAAA").as_deref(),
        Some("data:image/gif;base64,AAAA")
    );
    assert_eq!(
        content::image_url(None, "//cdn.example.com/x.png").as_deref(),
        Some("https://cdn.example.com/x.png")
    );
}

// ---------------------------------------------------------------------------
// Plain text and the selectable title
// ---------------------------------------------------------------------------

#[test]
fn plain_text_keeps_paragraphs_and_markers() {
    let blocks = vec![
        Block::Heading("Title".to_owned()),
        Block::Paragraph("Body".to_owned()),
        Block::Bullet("Item".to_owned()),
        Block::Quote("Quoted".to_owned()),
        Block::Code("a\nb".to_owned()),
        Block::Image("https://example.com/x.png".to_owned()),
        Block::Divider,
    ];

    assert_eq!(
        content::plain_text(&blocks),
        "Title\n\nBody\n\n• Item\n\n> Quoted\n\na\nb\n\nhttps://example.com/x.png\n\n---"
    );
}

#[test]
fn markdown_escaping_shows_the_title_literally() {
    assert_eq!(content::escape_markdown("A *b* [c]"), "A \\*b\\* \\[c\\]");
    assert_eq!(content::escape_markdown("C++ / Rust"), "C\\+\\+ \\/ Rust");
    // A title is one line in the pane, so its internal newlines become spaces.
    assert_eq!(content::escape_markdown("one\ntwo"), "one two");
}

// ---------------------------------------------------------------------------
// Finding the article in a fetched page
// ---------------------------------------------------------------------------

/// Prose long enough to clear the extractor's floor, which is a paragraph.
const PROSE: &str = "<p>Rome is a local-first reader. It keeps every entry in a \
     SQLite database beside the app, reads it with the system's own fonts, and \
     never asks a server what the reader has already seen. What a plugin hands \
     back is what the reader gets, and the host does not second-guess it.</p>";

/// A page with the shape a blog actually has: chrome around a story.
fn page(inner: &str) -> String {
    format!(
        "<!doctype html><html><head><title>Someone's blog</title>\
         <style>body {{ color: red }}</style></head>\
         <body><header><a href=\"/\">Home</a></header>\
         <nav><a href=\"/about\">About</a></nav>\
         {inner}\
         <footer>© 2026 Someone</footer>\
         <script>var tracking = 1;</script>\
         </body></html>"
    )
}

#[test]
fn the_article_element_is_the_part_that_survives() {
    let html = page(&format!(
        "<main><article>{PROSE}<p>A second paragraph.</p></article>\
         <aside>Read next: something else</aside></main>"
    ));

    let article = content::article(&html).expect("the page has an article in it");

    assert!(article.contains("local-first reader"));
    assert!(article.contains("A second paragraph."));
    assert!(!article.contains("Read next"));
    assert!(!article.contains("Home"));
    assert!(!article.contains("About"));
    assert!(!article.contains("Someone"));
    assert!(!article.contains("tracking"));
    assert!(!article.contains("color: red"));
}

#[test]
fn main_is_kept_when_the_page_has_no_article() {
    let html = page(&format!("<main>{PROSE}</main>"));

    let article = content::article(&html).expect("the page has a main in it");

    assert!(article.contains("local-first reader"));
    assert!(!article.contains("About"));
}

#[test]
fn a_page_with_neither_falls_back_to_its_body() {
    let html = page(&format!("<div class=\"post\">{PROSE}</div>"));

    let article = content::article(&html).expect("the body has prose in it");

    assert!(article.contains("local-first reader"));
    // The body is the last resort, so the furniture is all that is between the
    // reader and the story — and all of it has to go.
    assert!(!article.contains("Home"));
    assert!(!article.contains("About"));
    assert!(!article.contains("Someone"));
    assert!(!article.contains("tracking"));
}

#[test]
fn a_fragment_with_no_body_at_all_is_taken_whole() {
    let article = content::article(PROSE).expect("the fragment is the article");

    assert!(article.contains("local-first reader"));
}

#[test]
fn a_title_outside_a_body_does_not_become_prose() {
    let html = format!("<html><head><title>Someone's blog</title></head>{PROSE}</html>");

    let article = content::article(&html).expect("there is prose in the document");

    assert!(article.contains("local-first reader"));
    assert!(!article.contains("Someone's blog"));
}

#[test]
fn furniture_inside_the_article_is_dropped() {
    let html = page(&format!(
        "<article><header>By Someone</header>{PROSE}\
         <aside>Subscribe to the newsletter</aside>\
         <footer>Share this</footer></article>"
    ));

    let article = content::article(&html).expect("the page has an article in it");

    assert!(article.contains("local-first reader"));
    assert!(!article.contains("By Someone"));
    assert!(!article.contains("Subscribe to the newsletter"));
    assert!(!article.contains("Share this"));
}

#[test]
fn a_script_cannot_close_the_element_it_is_inside() {
    // The string looks like a closing tag and is not one. Reading it as markup
    // would end the article three lines into the page.
    let html = page(&format!(
        "<article><script>var template = \"</article><p>not prose</p>\";</script>\
         {PROSE}</article>"
    ));

    let article = content::article(&html).expect("the page has an article in it");

    assert!(article.contains("local-first reader"));
    assert!(!article.contains("not prose"));
    assert!(!article.contains("template"));
}

#[test]
fn a_nested_article_does_not_end_the_outer_one() {
    let html = page(&format!(
        "<article><article>{PROSE}</article><p>Still inside the outer one.</p></article>"
    ));

    let article = content::article(&html).expect("the page has an article in it");

    assert!(article.contains("Still inside the outer one."));
}

#[test]
fn a_page_with_nothing_to_read_is_not_an_article() {
    assert_eq!(
        content::article(&page("<article><p>Sign in to continue.</p></article>")),
        None
    );
    assert_eq!(content::article(&page("<article></article>")), None);
    assert_eq!(content::article(""), None);
}

#[test]
fn what_comes_back_is_html_the_stripper_can_read() {
    let html = page(&format!("<article><h1>A title</h1>{PROSE}</article>"));

    let article = content::article(&html).expect("the page has an article in it");

    // The point of keeping markup rather than text: the paragraph boundaries
    // are still there for `blocks` to find.
    assert_eq!(
        content::blocks(&article),
        vec![
            Block::Heading("A title".to_owned()),
            Block::Paragraph(
                "Rome is a local-first reader. It keeps every entry in a SQLite database beside \
                 the app, reads it with the system's own fonts, and never asks a server what the \
                 reader has already seen. What a plugin hands back is what the reader gets, and \
                 the host does not second-guess it."
                    .to_owned()
            ),
        ]
    );
}

#[test]
fn a_very_long_article_is_cut_at_a_tag() {
    let html = page(&format!("<article>{}</article>", PROSE.repeat(4000)));

    let article = content::article(&html).expect("the page has an article in it");

    // Half a megabyte is the cap, and the cut lands on a tag boundary: the
    // stripper would read a truncated `<p` as the literal text of a comparison.
    assert!(article.len() <= 512 * 1024);
    assert!(article.ends_with('>'));
    assert!(article.starts_with("<p>"));
}
