#!/usr/bin/env bash
set -euo pipefail

LABEL="${HHH_LAUNCHD_LABEL:-com.happyhealthyhethersett.api}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
START_SCRIPT="$APP_ROOT/scripts/start-api.sh"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/HappyHealthyHethersett"
CONFIG_DIR="$HOME/.config/happy-healthy-hethersett"
ENV_FILE="${HHH_API_ENV_FILE:-$CONFIG_DIR/api.env}"
SERVICE_TARGET="gui/$(id -u)"

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  printf '%s' "$value"
}

write_env_file_if_missing() {
  mkdir -p "$CONFIG_DIR"
  if [[ -f "$ENV_FILE" ]]; then
    return 0
  fi

  cat > "$ENV_FILE" <<'EOF'
# Happy Healthy Hethersett API environment.
# launchd does not inherit variables exported in Terminal, so put API settings here.

ASPNETCORE_URLS='http://localhost:5000'
ASPNETCORE_ENVIRONMENT='Production'

# Update this for the Mac/server where the API runs.
ConnectionStrings__DefaultConnection='Server=localhost;Port=3306;Database=happy_healthy_hethersett;User=hhh_app;Password=change-me;'

# Optional: only needed before the very first API run when there are no users yet.
# Remove or comment these after the first admin has been created.
# HHH_INITIAL_ADMIN_EMAIL='admin@example.com'
# HHH_INITIAL_ADMIN_PASSWORD='choose-a-long-temporary-password'

# Optional: set this if dotnet is installed somewhere unusual.
# HHH_DOTNET_BIN='/opt/homebrew/opt/dotnet@8/libexec/dotnet'
EOF
  chmod 600 "$ENV_FILE"
}

write_plist() {
  mkdir -p "$PLIST_DIR" "$LOG_DIR"
  chmod +x "$START_SCRIPT"

  local escaped_label escaped_script escaped_root escaped_log_out escaped_log_err escaped_env
  escaped_label="$(xml_escape "$LABEL")"
  escaped_script="$(xml_escape "$START_SCRIPT")"
  escaped_root="$(xml_escape "$APP_ROOT")"
  escaped_log_out="$(xml_escape "$LOG_DIR/api.out.log")"
  escaped_log_err="$(xml_escape "$LOG_DIR/api.err.log")"
  escaped_env="$(xml_escape "$ENV_FILE")"

  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$escaped_label</string>

  <key>ProgramArguments</key>
  <array>
    <string>$escaped_script</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$escaped_root</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HHH_API_ENV_FILE</key>
    <string>$escaped_env</string>
    <key>PATH</key>
    <string>/opt/homebrew/opt/dotnet@8/libexec:/opt/homebrew/bin:/usr/local/opt/dotnet@8/libexec:/usr/local/bin:/usr/local/share/dotnet:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$escaped_log_out</string>

  <key>StandardErrorPath</key>
  <string>$escaped_log_err</string>
</dict>
</plist>
EOF
}

unload_if_loaded() {
  launchctl bootout "$SERVICE_TARGET" "$PLIST_PATH" >/dev/null 2>&1 || true
}

install_agent() {
  write_env_file_if_missing
  write_plist
  unload_if_loaded
  launchctl bootstrap "$SERVICE_TARGET" "$PLIST_PATH"
  launchctl enable "$SERVICE_TARGET/$LABEL"
  launchctl kickstart -k "$SERVICE_TARGET/$LABEL"

  cat <<EOF
Installed $LABEL

Config: $ENV_FILE
Plist:  $PLIST_PATH
Logs:   $LOG_DIR/api.out.log
        $LOG_DIR/api.err.log

The API will start when this Mac user logs in. Edit the config file if the database
connection string or admin seed values need changing, then run:
  $0 restart
EOF
}

uninstall_agent() {
  unload_if_loaded
  rm -f "$PLIST_PATH"
  echo "Uninstalled $LABEL"
}

case "${1:-install}" in
  install)
    install_agent
    ;;
  uninstall)
    uninstall_agent
    ;;
  start)
    if [[ ! -f "$PLIST_PATH" ]]; then
      echo "LaunchAgent is not installed yet. Run: $0 install" >&2
      exit 66
    fi
    launchctl bootstrap "$SERVICE_TARGET" "$PLIST_PATH" 2>/dev/null || true
    launchctl enable "$SERVICE_TARGET/$LABEL"
    launchctl kickstart -k "$SERVICE_TARGET/$LABEL"
    ;;
  stop)
    unload_if_loaded
    ;;
  restart)
    if [[ ! -f "$PLIST_PATH" ]]; then
      echo "LaunchAgent is not installed yet. Run: $0 install" >&2
      exit 66
    fi
    unload_if_loaded
    launchctl bootstrap "$SERVICE_TARGET" "$PLIST_PATH"
    launchctl enable "$SERVICE_TARGET/$LABEL"
    launchctl kickstart -k "$SERVICE_TARGET/$LABEL"
    ;;
  status)
    launchctl print "$SERVICE_TARGET/$LABEL"
    ;;
  logs)
    tail -n 100 "$LOG_DIR/api.out.log" "$LOG_DIR/api.err.log"
    ;;
  *)
    echo "Usage: $0 [install|uninstall|start|stop|restart|status|logs]" >&2
    exit 64
    ;;
esac
