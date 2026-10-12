# Loading Space Skills

Use argument-free `get-skill` before acting on the Space. It loads the authenticated CLI root guide, using the Space override when present and appending live Skill Frames, with generated basic usage supplied by the local client. A failed request is an error, not proof that Space instructions were loaded.

Use `get-skill ID` for the focused workflow listed by the root guide. It returns only that guide, without global usage or Space instructions. Unknown IDs fail explicitly. `get-skill --help` explains this loading operation; global `--help` loads root context but may explicitly fall back to local usage when its bounded live request fails.
