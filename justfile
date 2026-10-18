# Run the app against a development database in .dev-data/, leaving the real one alone.
dev:
    ROME_DATA_DIR=.dev-data cargo run

# Run the app against the real database in the platform data directory.
run:
    cargo run

# Re-run the app whenever a file changes.
watch:
    ROME_DATA_DIR=.dev-data cargo watch --ignore .dev-data -x run

# Migration CLI against the development database, e.g. just migrate migration generate --name add_tags
migrate *args:
    ROME_DATA_DIR=.dev-data cargo run --bin migrate -- {{args}}

# Draw the window without opening one, and write the frames to shots/.
shots *args:
    ROME_SHOT_DIR=shots cargo test --test render -- {{args}}


# `just --list` shows the last comment line above a recipe, so the notes below
# live down here rather than above the recipes they describe.
#
# The dev database is ignored in `watch` explicitly. cargo-watch restarts on any
# write it sees, so watching the directory the app writes its SQLite file into
# would restart the app every time it touched the database, forever. `.gitignore`
# covers that directory too, but relying on it is fragile.
#
# bacon is also installed and is the better tool for continuous `check`/`clippy`
# feedback; it is a background checker rather than something that restarts the
# app, so it does not replace this recipe.
