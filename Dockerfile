ARG DENO_VERSION=2.7.1

FROM denoland/deno:${DENO_VERSION}

WORKDIR /app

# Cache dependencies
COPY deno.json deno.lock ./
RUN deno install

# Copy source
COPY . .

EXPOSE 3000

# Optional entrypoint script can be mounted at /app/entrypoint.sh
# to run migrations or other setup before starting the app.
# If not mounted, the app starts directly.
CMD ["sh", "-c", "if [ -f /app/entrypoint.sh ]; then sh /app/entrypoint.sh; else deno task serve; fi"]
