<!-- GOOGLE-ACCOUNT-SWITCHER -->
## Google 帳號設定

本專案綁定: **kuo.tinghow@gmail.com** | GCloud: **** | Firebase: ****

帳號切換由 Claude Code Hooks 自動處理：
- SessionStart: 開啟專案時自動切換到正確帳號
- PreToolUse: 每次執行 deploy 指令前自動驗證並切換帳號

如需手動驗證: `gcloud auth list --filter="status:ACTIVE" --format="value(account)"`
<!-- /GOOGLE-ACCOUNT-SWITCHER -->
