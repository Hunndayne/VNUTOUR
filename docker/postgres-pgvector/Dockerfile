# Staging Postgres with the pgvector extension, required by the photo gallery.
#
# Stays on the same base as components/db-simple (postgres:16 on Alpine/musl)
# so the existing data volume keeps its major version and collation library.
# Switching to the Debian-based pgvector/pgvector image would change libc and
# risk silently corrupting text indexes on the existing volume.
FROM postgres:16-alpine

ARG PGVECTOR_VERSION=0.8.0

# OPTFLAGS="" drops pgvector's default -march=native so the image runs on any
# x86-64 node, not just the CI runner's CPU. with_llvm=no skips JIT bitcode,
# which would otherwise need a clang matching the server's LLVM build.
# hadolint ignore=DL3018
RUN apk add --no-cache --virtual .pgvector-build build-base git \
    && git clone --branch "v${PGVECTOR_VERSION}" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && make -C /tmp/pgvector OPTFLAGS="" with_llvm=no \
    && make -C /tmp/pgvector install with_llvm=no \
    && rm -rf /tmp/pgvector \
    && apk del .pgvector-build
