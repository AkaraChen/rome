//! The order of the view rows, and how a stored preference is turned back into
//! a list of views.
//!
//! A module of its own because this is the one part of the feature that is pure:
//! it takes a value that came out of the database and returns the order to draw,
//! with no database, no window and no worker involved. Everything that could be
//! got subtly wrong — and every way a stored preference can be stale — is
//! settled here, where it can be tested directly.
//!
//! The stored form is a JSON array of view *names*:
//!
//! ```json
//! ["articles", "pictures", "social"]
//! ```
//!
//! Names rather than the integer discriminants the rest of the schema uses for
//! a view. A `View` is stored as a number on a source because that number is
//! written and read by the same version of the app. This value outlives the
//! version that wrote it: a later release may insert a variant in the middle of
//! the enum, which would silently reinterpret every stored position. A name
//! means what it says, or it means nothing and is dropped.

use serde_json::{Value, json};

use crate::models::View;

/// The preference key this is filed under.
pub const KEY: &str = "view_order";

/// The order to draw the view rows in, given whatever is stored.
///
/// The result is always every view, exactly once — which is the whole
/// difficulty, because the stored value is a snapshot of a list that the app is
/// free to change underneath it:
///
/// - A name the app does not recognise is **dropped**. A view removed in a
///   later release must not come back as a row that filters by nothing.
/// - A name that appears twice is **kept once**. Nothing writes a duplicate,
///   but a value the user edited by hand should still draw a sane sidebar.
/// - A view the stored value never mentioned is **appended**, in the enum's own
///   order. A view added in a later release has to appear somewhere, and the
///   end is the only place that does not displace a choice the user made.
///
/// `None` — nothing stored, which is every database until the first reorder —
/// gives the enum's order, so a first launch looks exactly as it did before
/// this preference existed.
pub fn resolve(stored: Option<&Value>) -> Vec<View> {
    let mut order: Vec<View> = Vec::with_capacity(View::ALL.len());

    if let Some(names) = stored.and_then(Value::as_array) {
        for name in names.iter().filter_map(Value::as_str) {
            let Some(view) = View::from_name(name) else {
                continue;
            };

            if !order.contains(&view) {
                order.push(view);
            }
        }
    }

    // Collected before extending: `extend` holds `order` mutably, so it cannot
    // also be read by the predicate.
    let missing: Vec<View> = View::ALL
        .into_iter()
        .filter(|view| !order.contains(view))
        .collect();

    order.extend(missing);

    order
}

/// The value to store for a given order.
///
/// Written from the *resolved* order rather than from whatever was in the
/// database, so the first reorder replaces a stale or hand-edited value with a
/// complete, current one. What is stored afterwards is exactly what is drawn.
pub fn encode(order: &[View]) -> Value {
    json!(order.iter().map(|view| view.name()).collect::<Vec<_>>())
}

/// The order after moving `view` by `delta` places.
///
/// `delta` is `-1` for up and `1` for down; the caller has already resolved the
/// order, so this takes and returns a complete list. A move off either end is
/// **not** an error and not a wrap: it returns the order unchanged. A row that
/// jumped from the bottom to the top when the user asked it to go down would be
/// the sort of thing that makes an app feel broken.
///
/// A `view` that is not in the list is likewise left alone rather than appended
/// — the caller passes a view it drew a row for, so this cannot happen, and
/// inventing a position for it would be worse than doing nothing.
pub fn moved(order: &[View], view: View, delta: i32) -> Vec<View> {
    let mut order = order.to_vec();

    let Some(from) = order.iter().position(|candidate| *candidate == view) else {
        return order;
    };

    let Some(to) = from.checked_add_signed(delta as isize) else {
        return order;
    };

    if to >= order.len() {
        return order;
    }

    order.swap(from, to);

    order
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(order: &[View]) -> Vec<&'static str> {
        order.iter().map(|view| view.name()).collect()
    }

    #[test]
    fn nothing_stored_is_the_order_the_enum_declares() {
        assert_eq!(resolve(None), View::ALL.to_vec());
        assert_eq!(resolve(Some(&json!(null))), View::ALL.to_vec());
    }

    #[test]
    fn a_stored_order_is_honoured() {
        let stored = json!(["pictures", "articles"]);

        assert_eq!(
            names(&resolve(Some(&stored))),
            ["pictures", "articles", "social", "videos", "audios", "notifications"]
        );
    }

    #[test]
    fn a_view_the_preference_never_mentions_is_appended() {
        // The case that matters on upgrade: a release adds a view, and the
        // stored preference predates it. It must appear, and it must not
        // displace anything the user chose.
        let stored = json!(["pictures"]);

        let order = resolve(Some(&stored));

        assert_eq!(order.len(), View::ALL.len());
        assert_eq!(order[0], View::Pictures);
        assert_eq!(&names(&order)[1..], ["articles", "social", "videos", "audios", "notifications"]);
    }

    #[test]
    fn a_name_the_app_does_not_know_is_dropped() {
        let stored = json!(["articles", "podcasts", "quotes"]);

        let order = resolve(Some(&stored));

        assert_eq!(order.len(), View::ALL.len());
        assert!(!names(&order).contains(&"podcasts"));
    }

    #[test]
    fn a_repeated_name_draws_one_row() {
        let stored = json!(["pictures", "pictures", "articles"]);

        let order = resolve(Some(&stored));

        assert_eq!(order.len(), View::ALL.len());
        assert_eq!(order.iter().filter(|view| **view == View::Pictures).count(), 1);
    }

    #[test]
    fn a_stored_value_of_the_wrong_shape_is_ignored() {
        // Anything but an array of strings is treated as nothing stored, so a
        // preference written by a future version — or by hand, wrongly — costs
        // the user their ordering rather than their sidebar.
        for stored in [json!("articles"), json!(7), json!({"a": 1}), json!([1, 2])] {
            assert_eq!(resolve(Some(&stored)), View::ALL.to_vec(), "{stored}");
        }
    }

    #[test]
    fn a_round_trip_through_the_stored_form_is_lossless() {
        let order = vec![
            View::Pictures,
            View::Notifications,
            View::Articles,
            View::Videos,
            View::Audios,
            View::SocialMedia,
        ];

        assert_eq!(resolve(Some(&encode(&order))), order);
    }

    #[test]
    fn moving_swaps_with_the_neighbour() {
        let order = resolve(None);

        let moved = moved(&order, View::Pictures, -1);

        assert_eq!(moved[1], View::Pictures);
        assert_eq!(moved[2], View::SocialMedia);
        assert_eq!(moved.len(), order.len());
    }

    #[test]
    fn moving_off_either_end_does_nothing() {
        let order = resolve(None);

        assert_eq!(moved(&order, View::Articles, -1), order);
        assert_eq!(moved(&order, View::Notifications, 1), order);
        // Not even a wrap: the last row asked to go down stays where it is.
        assert_eq!(moved(&order, View::Notifications, 2), order);
    }

    #[test]
    fn moving_a_view_that_is_not_there_changes_nothing() {
        let order = vec![View::Articles, View::Pictures];

        assert_eq!(moved(&order, View::Videos, 1), order);
    }
}
