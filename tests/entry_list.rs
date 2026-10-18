//! The article list's keyboard arithmetic.
//!
//! Only the decision of *which* row a key moves to is tested. Everything else
//! in that pane needs a window to observe, and the interesting mistakes are all
//! in the arithmetic at the ends of the list — an off-by-one at the bottom of a
//! list is the kind of bug that only shows up after the reader has scrolled
//! through everything above it.

use rome::snapshot::EntryRow;
use rome::ui::entry_list::navigation;

/// Three rows with ids 1, 2 and 3, which is all the navigation looks at.
fn rows() -> Vec<EntryRow> {
    (1..=3)
        .map(|id| EntryRow {
            id,
            source_id: 1,
            source_title: "source".to_owned(),
            title: format!("entry {id}"),
            url: None,
            author: None,
            published_at: None,
            summary: None,
            image: None,
            read: false,
            starred: false,
        })
        .collect()
}

#[test]
fn down_opens_the_first_row_when_nothing_is_open() {
    assert_eq!(navigation("down", &rows(), None), Some(0));
    assert_eq!(navigation("j", &rows(), None), Some(0));
}

#[test]
fn down_advances_and_stops_at_the_end() {
    assert_eq!(navigation("down", &rows(), Some(1)), Some(1));
    assert_eq!(navigation("j", &rows(), Some(2)), Some(2));
    assert_eq!(navigation("down", &rows(), Some(3)), Some(2));
}

#[test]
fn up_opens_the_last_row_when_nothing_is_open() {
    assert_eq!(navigation("up", &rows(), None), Some(2));
    assert_eq!(navigation("k", &rows(), None), Some(2));
}

#[test]
fn up_goes_back_and_stops_at_the_start() {
    assert_eq!(navigation("up", &rows(), Some(3)), Some(1));
    assert_eq!(navigation("k", &rows(), Some(2)), Some(0));
    assert_eq!(navigation("up", &rows(), Some(1)), Some(0));
}

#[test]
fn enter_reopens_what_is_open_and_starts_at_the_top_otherwise() {
    assert_eq!(navigation("enter", &rows(), None), Some(0));
    assert_eq!(navigation("enter", &rows(), Some(2)), Some(1));
}

#[test]
fn an_open_entry_that_is_no_longer_listed_starts_from_an_end() {
    // A search or a tab switch can leave the reading pane showing an entry the
    // list does not contain; the next arrow should still go somewhere.
    assert_eq!(navigation("down", &rows(), Some(99)), Some(0));
    assert_eq!(navigation("up", &rows(), Some(99)), Some(2));
}

#[test]
fn other_keys_and_an_empty_list_move_nowhere() {
    assert_eq!(navigation("x", &rows(), None), None);
    assert_eq!(navigation("", &rows(), None), None);
    assert_eq!(navigation("down", &[], None), None);
    assert_eq!(navigation("enter", &[], Some(1)), None);
}
