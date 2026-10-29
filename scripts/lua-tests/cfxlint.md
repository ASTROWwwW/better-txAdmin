# Checking the Lua grammar

The resource is CfxLua (Lua 5.4 plus extensions such as `+=`, safe navigation and backtick hashes), which plain `luac` rejects.
Use a CfxLua aware linter, for example the `cfxlint.py` of the Potklin skill (`skills/potklin/cfxlint.py` in the claude-skills repository):

```bash
python3 cfxlint.py resource/sv_playerlist.lua resource/sv_main.lua
```

Existing warnings (`bool-compare`) come from upstream code and are not errors.
