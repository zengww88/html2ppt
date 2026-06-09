#!/bin/zsh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required."
  echo "Please install the LTS version from https://nodejs.org/"
  echo "Then double-click this file again."
  read "?Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies. This runs only the first time..."
  npm install || {
    echo "npm install failed."
    read "?Press Enter to close..."
    exit 1
  }
fi

echo "Starting Visual HTML PPT Editor..."
echo "Please wait for the server to start..."
echo ""

# Start the development server in the background
npm run dev &

# Wait for the server to start
echo "Waiting for server to start..."
while ! curl -s http://127.0.0.1:5173 > /dev/null 2>&1; do
  sleep 2
done

echo "Server is ready!"
echo "Opening browser at http://127.0.0.1:5173"
echo "Keep this window open while using the editor."
echo ""

open "http://127.0.0.1:5173"

# Keep the script running
wait
