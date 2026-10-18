//! Filing an entry into one of the user's lists.
//!
//! A list is the one piece of structure the user builds by hand — plugins
//! decide what exists, and this decides what it means to them. The whole
//! interaction is one dialog because the decision is one decision: which list,
//! and if the answer is "a new one", what to call it. Picking an existing list
//! is a button; naming a new one is the dialog's own confirm, so the two never
//! look like the same kind of step.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::dialog::DialogButtonProps;
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::{ActiveTheme, WindowExt, v_flex};
use gpui_kit::*;

use crate::snapshot::ListRow;
use crate::worker::{Command, Worker};

/// Ask where `entry_id` should go, and send it there.
pub fn add_to_list(
    entry_id: u64,
    lists: Vec<ListRow>,
    window: &mut Window,
    cx: &mut App,
    worker: Worker,
) {
    // Built before the dialog rather than inside it: a text input is an entity
    // in GPUI, and the dialog's content builder is an `Fn` that may run again
    // on any redraw — creating the entity there would replace it mid-typing and
    // take the caret with it.
    let input = cx.new(|cx| InputState::new(window, cx).placeholder("新列表的名字"));

    window.open_alert_dialog(cx, move |dialog, _, _| {
        let lists = lists.clone();
        let input = input.clone();
        let worker = worker.clone();

        dialog
            .w(px(360.))
            .title("加入列表")
            .button_props(
                DialogButtonProps::default()
                    .ok_text("新建并加入")
                    .cancel_text("取消")
                    .show_cancel(true),
            )
            .content({
                let input = input.clone();
                let worker = worker.clone();

                move |content, _, cx| {
                    let mut content = content;

                    if lists.is_empty() {
                        content = content.child(
                            div()
                                .text_xs()
                                .line_height(px(18.))
                                .text_color(cx.theme().muted_foreground)
                                .child("还没有列表。给下面这个起个名字，它会成为第一个。"),
                        );
                    }

                    content.child(
                        v_flex().w_full().gap_1().children(lists.iter().map(|list| {
                            let worker = worker.clone();
                            let list_id = list.id;

                            Button::new(format!("file-into:{}", list.id))
                                .ghost()
                                .w_full()
                                .label(list.name.clone())
                                .on_click(move |_, window, cx| {
                                    worker.send(Command::AddToList { list_id, entry_id });
                                    window.close_dialog(cx);
                                })
                        })),
                    )
                    .child(
                        // The field is always here, not behind a "new list"
                        // button: a reader with no lists yet is the one most
                        // likely to be reading this dialog, and making them
                        // press a second button to find out they can type is a
                        // step for nothing.
                        div()
                            .mt_2()
                            .child(Input::new(&input).bordered(true)),
                    )
                }
            })
            .on_ok({
                let input = input.clone();
                let worker = worker.clone();

                move |_, _, cx| {
                    let name = input.read(cx).value().trim().to_owned();

                    // Kept open on an empty name for the same reason the
                    // prompt is: the field is the only thing that can answer
                    // "where should this go", and closing on nothing would
                    // read as if it had been filed somewhere.
                    if name.is_empty() {
                        return false;
                    }

                    worker.send(Command::FileInto { name, entry_id });
                    true
                }
            })
    });
}
