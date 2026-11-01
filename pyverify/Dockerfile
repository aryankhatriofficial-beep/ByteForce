FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src

RUN python -m pip install --no-cache-dir .

USER 65532:65532

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c 'import os, urllib.request; port = os.environ.get("PYVERIFY_API_PORT") or os.environ.get("PORT", "8765"); urllib.request.urlopen("http://127.0.0.1:" + port + "/api/health", timeout=2).read()'

CMD ["python", "-m", "pyverify.api"]
