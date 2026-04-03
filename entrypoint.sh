#!/bin/sh
set -e

echo "Running database migrations..."
deno run -A --node-modules-dir npm:drizzle-kit migrate

echo "Starting application..."
exec deno task serve
