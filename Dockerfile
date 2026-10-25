FROM node:24-bookworm-slim

LABEL org.opencontainers.image.source="https://github.com/pixlcore/xycli"
LABEL org.opencontainers.image.description="The xyOps command-line interface and MCP server."
LABEL org.opencontainers.image.licenses="MIT"

ENV DEBIAN_FRONTEND=noninteractive

# Keep the runtime small: no worker tools, compilers, or Docker CLI are needed.
# Remove apt caches in the same layer that installs the certificate bundle.
RUN set -eu; \
	apt-get update; \
	apt-get install -y --no-install-recommends ca-certificates; \
	apt-get clean; \
	rm -rf /var/lib/apt/lists/*

WORKDIR /opt/xycli

ENV NODE_ENV=production

# Install the tagged checkout's locked dependencies, rather than fetching an
# unrelated CLI release from npm. Source edits can reuse the dependency layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
	&& npm cache clean --force

# .dockerignore includes only runtime source and documentation, so local
# node_modules links, test fixtures, and private configuration stay outside.
COPY . .

# Keep the application read-only for the runtime user, with a writable working
# directory for commands that export or sync files.
RUN ln -s /opt/xycli/index.js /usr/local/bin/xy \
	&& mkdir -p /workspace \
	&& chown node:node /workspace

USER node
WORKDIR /workspace

EXPOSE 8080/tcp

# Arguments after the image name replace CMD, allowing any xyCLI command.
# HTTP needs an explicit allowed_hosts list supplied in XYOPS_MCP or cli.json.
ENTRYPOINT ["xy"]
CMD ["mcp", "serve", "--host", "0.0.0.0", "--port", "8080"]
