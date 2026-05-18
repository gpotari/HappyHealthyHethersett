#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${HHH_API_ENV_FILE:-$HOME/.config/happy-healthy-hethersett/api.env}"
PUBLISHED_DLL="$APP_ROOT/api/bin/Release/net8.0/publish/HappyHealthyHethersett.Api.dll"
PROJECT_FILE="$APP_ROOT/api/HappyHealthyHethersett.Api.csproj"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

export ASPNETCORE_ENVIRONMENT="${ASPNETCORE_ENVIRONMENT:-Production}"
export ASPNETCORE_URLS="${ASPNETCORE_URLS:-http://localhost:5000}"
export DOTNET_CLI_TELEMETRY_OPTOUT="${DOTNET_CLI_TELEMETRY_OPTOUT:-1}"

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
      echo "HHH_DOTNET_BIN does not point to .NET 8+: $HHH_DOTNET_BIN" >&2
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

DOTNET_BIN="$(find_dotnet)" || {
  echo "Unable to find .NET 8+. Set HHH_DOTNET_BIN in $ENV_FILE." >&2
  exit 1
}

cd "$APP_ROOT"

if [[ -f "$PUBLISHED_DLL" ]]; then
  exec "$DOTNET_BIN" "$PUBLISHED_DLL"
fi

exec "$DOTNET_BIN" run --project "$PROJECT_FILE" --urls "$ASPNETCORE_URLS"
