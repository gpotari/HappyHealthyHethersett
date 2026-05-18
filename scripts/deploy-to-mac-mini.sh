#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

TARGET="${1:-${HHH_DEPLOY_TARGET:-}}"
REMOTE_WEB_ROOT="${HHH_REMOTE_WEB_ROOT:-/opt/homebrew/var/www/hhh}"
REMOTE_API_ROOT="${HHH_REMOTE_API_ROOT:-/opt/homebrew/var/www/hhh-api}"
REMOTE_API_ENV_FILE="${HHH_REMOTE_API_ENV_FILE:-}"
LOCAL_API_ENV_FILE="${HHH_DEPLOY_API_ENV_FILE:-}"
REMOTE_CONNECTION_STRING="${HHH_REMOTE_CONNECTION_STRING:-}"
REMOTE_INITIAL_ADMIN_EMAIL="${HHH_INITIAL_ADMIN_EMAIL:-}"
REMOTE_INITIAL_ADMIN_PASSWORD="${HHH_INITIAL_ADMIN_PASSWORD:-}"
CLIENT_DIST="$APP_ROOT/dist/happy-healthy-hethersett"
API_PUBLISH_DIR="$APP_ROOT/dist/hhh-api-publish"
API_PROJECT="$APP_ROOT/api/HappyHealthyHethersett.Api.csproj"
SSH_CONTROL_DIR="/tmp/hhh-deploy-${UID:-$(id -u)}-$$"
SSH_CONTROL_PATH="$SSH_CONTROL_DIR/ctl"

usage() {
  cat <<EOF
Usage:
  $0 user@mac-mini.local

Or set:
  HHH_DEPLOY_TARGET='user@mac-mini.local'

Optional settings:
  HHH_REMOTE_WEB_ROOT='/opt/homebrew/var/www/hhh'
  HHH_REMOTE_API_ROOT='/opt/homebrew/var/www/hhh-api'
  HHH_DEPLOY_API_ENV_FILE='/path/to/api.env'
  HHH_REMOTE_API_ENV_FILE='/Users/your-user/.config/happy-healthy-hethersett/api.env'
  HHH_REMOTE_CONNECTION_STRING='server=localhost;...'
  HHH_PROMPT_REMOTE_CONNECTION_STRING='1'
  HHH_INITIAL_ADMIN_EMAIL='admin@example.com'
  HHH_PROMPT_INITIAL_ADMIN='1'
  HHH_DEPLOY_SKIP_API_RESTART='1'
  HHH_DOTNET_RESTORE='1'
  HHH_DOTNET_BIN='/opt/homebrew/opt/dotnet@8/libexec/dotnet'
EOF
}

fail() {
  echo "Deploy failed: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found."
}

shell_quote() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}

dotnet_supports_net8() {
  local bin="$1"
  local version major

  version="$("$bin" --version 2>/dev/null | head -n 1)" || return 1
  major="${version%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  (( major >= 8 ))
}

find_dotnet() {
  if [[ -n "${HHH_DOTNET_BIN:-}" ]]; then
    if [[ ! -x "$HHH_DOTNET_BIN" ]]; then
      echo "HHH_DOTNET_BIN is not executable: $HHH_DOTNET_BIN" >&2
      return 1
    fi
    if ! dotnet_supports_net8 "$HHH_DOTNET_BIN"; then
      echo "HHH_DOTNET_BIN does not point to a .NET 8+ SDK: $HHH_DOTNET_BIN" >&2
      return 1
    fi
    printf '%s\n' "$HHH_DOTNET_BIN"
    return 0
  fi

  local candidate
  for candidate in \
    /opt/homebrew/opt/dotnet@8/libexec/dotnet \
    /usr/local/opt/dotnet@8/libexec/dotnet \
    /opt/homebrew/bin/dotnet \
    /usr/local/bin/dotnet \
    /usr/local/share/dotnet/dotnet \
    "$(command -v dotnet 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]] && dotnet_supports_net8 "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

validate_remote_path() {
  local name="$1"
  local path="$2"

  [[ -n "$path" ]] || fail "$name is empty."
  [[ "$path" == /* ]] || fail "$name must be an absolute path: $path"
  [[ "$path" != "/" ]] || fail "$name cannot be /"
  [[ "$path" != "/opt/homebrew" ]] || fail "$name is too broad: $path"
  [[ "$path" != "/opt/homebrew/var" ]] || fail "$name is too broad: $path"
  [[ "$path" != "/opt/homebrew/var/www" ]] || fail "$name is too broad: $path"
}

if [[ -z "$TARGET" || "$TARGET" == "-h" || "$TARGET" == "--help" ]]; then
  usage
  [[ -n "$TARGET" ]] && exit 0
  exit 64
fi

validate_remote_path "HHH_REMOTE_WEB_ROOT" "$REMOTE_WEB_ROOT"
validate_remote_path "HHH_REMOTE_API_ROOT" "$REMOTE_API_ROOT"
if [[ -n "$REMOTE_API_ENV_FILE" && "$REMOTE_API_ENV_FILE" != /* ]]; then
  fail "HHH_REMOTE_API_ENV_FILE must be an absolute path when set: $REMOTE_API_ENV_FILE"
fi
if [[ -n "$LOCAL_API_ENV_FILE" && -n "$REMOTE_CONNECTION_STRING" ]]; then
  fail "Use either HHH_DEPLOY_API_ENV_FILE or HHH_REMOTE_CONNECTION_STRING, not both."
fi
if [[ "${HHH_PROMPT_REMOTE_CONNECTION_STRING:-0}" == "1" ]]; then
  if [[ -n "$LOCAL_API_ENV_FILE" ]]; then
    fail "Use either HHH_DEPLOY_API_ENV_FILE or HHH_PROMPT_REMOTE_CONNECTION_STRING, not both."
  fi
  printf 'Remote API database connection string: '
  IFS= read -r -s REMOTE_CONNECTION_STRING
  printf '\n'
  [[ -n "$REMOTE_CONNECTION_STRING" ]] || fail "Remote connection string cannot be empty."
fi
if [[ "${HHH_PROMPT_INITIAL_ADMIN:-0}" == "1" ]]; then
  printf 'Initial admin email: '
  IFS= read -r REMOTE_INITIAL_ADMIN_EMAIL
  printf 'Initial admin password: '
  IFS= read -r -s REMOTE_INITIAL_ADMIN_PASSWORD
  printf '\n'
  [[ -n "$REMOTE_INITIAL_ADMIN_EMAIL" ]] || fail "Initial admin email cannot be empty."
  [[ ${#REMOTE_INITIAL_ADMIN_PASSWORD} -ge 10 ]] || fail "Initial admin password must be at least 10 characters."
fi

require_command npm
require_command ssh
require_command rsync

DOTNET_BIN="$(find_dotnet)" || fail "A .NET 8+ SDK was not found. Set HHH_DOTNET_BIN to your .NET 8 dotnet path, for example /opt/homebrew/opt/dotnet@8/libexec/dotnet."

cd "$APP_ROOT"

mkdir -p "$SSH_CONTROL_DIR"
chmod 700 "$SSH_CONTROL_DIR"
SSH_OPTS=(-o ControlMaster=auto -o ControlPersist=10m -o ControlPath="$SSH_CONTROL_PATH")
RSYNC_SSH="ssh -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=$SSH_CONTROL_PATH"

cleanup_ssh_control() {
  ssh "${SSH_OPTS[@]}" -O exit "$TARGET" >/dev/null 2>&1 || true
  rm -rf "$SSH_CONTROL_DIR"
}
trap cleanup_ssh_control EXIT

effective_remote_api_env_file() {
  if [[ -n "$REMOTE_API_ENV_FILE" ]]; then
    printf '%s\n' "$REMOTE_API_ENV_FILE"
    return 0
  fi

  local remote_home
  remote_home="$(ssh "${SSH_OPTS[@]}" "$TARGET" 'printf %s "$HOME"')" || return 1
  printf '%s/.config/happy-healthy-hethersett/api.env\n' "$remote_home"
}

upload_generated_api_env() {
  local env_file="$1"
  local env_dir
  env_dir="$(dirname "$env_file")"

  {
    printf '# Happy Healthy Hethersett API environment.\n'
    printf '# Generated by scripts/deploy-to-mac-mini.sh.\n\n'
    printf 'ASPNETCORE_URLS=%s\n' "$(shell_quote 'http://localhost:5000')"
    printf 'ASPNETCORE_ENVIRONMENT=%s\n' "$(shell_quote 'Production')"
    printf 'ConnectionStrings__DefaultConnection=%s\n' "$(shell_quote "$REMOTE_CONNECTION_STRING")"
    if [[ -n "$REMOTE_INITIAL_ADMIN_EMAIL" && -n "$REMOTE_INITIAL_ADMIN_PASSWORD" ]]; then
      printf 'HHH_INITIAL_ADMIN_EMAIL=%s\n' "$(shell_quote "$REMOTE_INITIAL_ADMIN_EMAIL")"
      printf 'HHH_INITIAL_ADMIN_PASSWORD=%s\n' "$(shell_quote "$REMOTE_INITIAL_ADMIN_PASSWORD")"
    fi
  } | ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p $(shell_quote "$env_dir") && umask 077 && cat > $(shell_quote "$env_file")"
}

echo "Deploy target: $TARGET"
echo "Website root:  $REMOTE_WEB_ROOT"
echo "API root:      $REMOTE_API_ROOT"
echo "dotnet:        $DOTNET_BIN ($("$DOTNET_BIN" --version))"
echo

echo "Building Angular client..."
npm run build -- --configuration production

echo
echo "Publishing .NET API..."
mkdir -p "$API_PUBLISH_DIR"
publish_args=(publish "$API_PROJECT" --configuration Release --output "$API_PUBLISH_DIR")
if [[ "${HHH_DOTNET_RESTORE:-0}" != "1" ]]; then
  publish_args+=(--no-restore)
fi
"$DOTNET_BIN" "${publish_args[@]}"

echo
echo "Preparing remote folders..."
ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p '$REMOTE_WEB_ROOT' '$REMOTE_API_ROOT/api/bin/Release/net8.0/publish' '$REMOTE_API_ROOT/scripts'"

EFFECTIVE_REMOTE_API_ENV_FILE="$REMOTE_API_ENV_FILE"
if [[ -n "$LOCAL_API_ENV_FILE" ]]; then
  [[ -f "$LOCAL_API_ENV_FILE" ]] || fail "HHH_DEPLOY_API_ENV_FILE does not exist: $LOCAL_API_ENV_FILE"
  EFFECTIVE_REMOTE_API_ENV_FILE="$(effective_remote_api_env_file)" || fail "Could not resolve the remote API env file path."
  echo "Copying API environment file..."
  ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p $(shell_quote "$(dirname "$EFFECTIVE_REMOTE_API_ENV_FILE")")"
  rsync -az -e "$RSYNC_SSH" "$LOCAL_API_ENV_FILE" "$TARGET:$EFFECTIVE_REMOTE_API_ENV_FILE"
elif [[ -n "$REMOTE_CONNECTION_STRING" ]]; then
  EFFECTIVE_REMOTE_API_ENV_FILE="$(effective_remote_api_env_file)" || fail "Could not resolve the remote API env file path."
  echo "Writing remote API environment file..."
  upload_generated_api_env "$EFFECTIVE_REMOTE_API_ENV_FILE"
fi

echo
echo "Uploading website to nginx folder..."
rsync -az -e "$RSYNC_SSH" --delete --delete-excluded --exclude '.DS_Store' "$CLIENT_DIST/" "$TARGET:$REMOTE_WEB_ROOT/"

echo
echo "Uploading API publish output..."
rsync -az -e "$RSYNC_SSH" --delete --exclude '.DS_Store' "$API_PUBLISH_DIR/" "$TARGET:$REMOTE_API_ROOT/api/bin/Release/net8.0/publish/"

echo
echo "Uploading API launch scripts..."
rsync -az -e "$RSYNC_SSH" --exclude '.DS_Store' \
  "$APP_ROOT/scripts/start-api.sh" \
  "$APP_ROOT/scripts/install-api-launch-agent.sh" \
  "$APP_ROOT/scripts/api.env.example" \
  "$TARGET:$REMOTE_API_ROOT/scripts/"

if [[ "${HHH_DEPLOY_SKIP_API_RESTART:-0}" != "1" ]]; then
  echo
  echo "Installing/restarting API LaunchAgent..."
  if [[ -n "$EFFECTIVE_REMOTE_API_ENV_FILE" ]]; then
    ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$REMOTE_API_ROOT' && HHH_API_ENV_FILE=$(shell_quote "$EFFECTIVE_REMOTE_API_ENV_FILE") ./scripts/install-api-launch-agent.sh install"
  else
    ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$REMOTE_API_ROOT' && ./scripts/install-api-launch-agent.sh install"
  fi
else
  echo
  echo "Skipped API restart because HHH_DEPLOY_SKIP_API_RESTART=1."
fi

cat <<EOF

Deploy complete.

Website:
  $REMOTE_WEB_ROOT

API:
  $REMOTE_API_ROOT

Remote API config:
  ${EFFECTIVE_REMOTE_API_ENV_FILE:-~/.config/happy-healthy-hethersett/api.env}

Remote API logs:
  ~/Library/Logs/HappyHealthyHethersett/api.out.log
  ~/Library/Logs/HappyHealthyHethersett/api.err.log
EOF
