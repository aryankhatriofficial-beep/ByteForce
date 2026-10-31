"""Small deadline-aware HTTPS GET transport for PyVerify."""

import asyncio
import ssl
import time
from urllib.parse import urljoin, urlsplit


_MAX_REDIRECTS = 10
_MAX_HEADER_BYTES = 64 * 1024


def _validate_url(url, allowed_host):
    try:
        if any(ord(char) < 0x20 or ord(char) == 0x7F for char in url):
            raise ValueError("Control character in URL")
        parsed = urlsplit(url)
        valid = (
            parsed.scheme == "https"
            and parsed.hostname == allowed_host
            and parsed.username is None
            and parsed.password is None
            and parsed.port in (None, 443)
        )
    except (TypeError, ValueError):
        valid = False
    if not valid:
        raise ValueError("Untrusted HTTPS URL")
    return parsed


async def _within_deadline(awaitable, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        if hasattr(awaitable, "close"):
            awaitable.close()
        raise TimeoutError("Operation exceeded its total time limit")
    return await asyncio.wait_for(awaitable, timeout=remaining)


class HTTPSResponse:
    def __init__(self, url, status, headers, reader, writer, deadline):
        self.url = url
        self.status = status
        self.headers = headers
        self._reader = reader
        self._writer = writer
        self._deadline = deadline

    def close(self):
        self._writer.close()

    async def _read(self, size):
        return await _within_deadline(self._reader.read(size), self._deadline)

    async def _readline(self):
        line = await _within_deadline(self._reader.readline(), self._deadline)
        if len(line) > _MAX_HEADER_BYTES:
            raise ValueError("HTTPS response line exceeds the allowed size")
        return line

    async def _read_exactly(self, size):
        return await _within_deadline(self._reader.readexactly(size), self._deadline)

    async def iter_bytes(self, chunk_size, max_bytes):
        """Yield body bytes, enforcing framing, deadline, and byte limits."""
        if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes < 0:
            raise ValueError("max_bytes must be a non-negative integer")

        transfer_encoding = self.headers.get("transfer-encoding", "").lower()
        content_length = self.headers.get("content-length")
        if transfer_encoding and content_length is not None:
            raise ValueError("Ambiguous HTTPS response body framing")
        if transfer_encoding and transfer_encoding != "chunked":
            raise ValueError("Unsupported HTTPS response transfer encoding")

        if content_length is not None:
            if not content_length.isascii() or not content_length.isdecimal():
                raise ValueError("Invalid HTTPS response Content-Length")
            declared_length = int(content_length)
            if declared_length > max_bytes:
                raise ValueError("HTTPS response exceeds the configured maximum size")
        else:
            declared_length = None

        received = 0
        if transfer_encoding == "chunked":
            while True:
                line = await self._readline()
                try:
                    size_text = line.strip().split(b";", 1)[0]
                    chunk_length = int(size_text, 16)
                except (ValueError, IndexError) as exc:
                    raise ValueError("Invalid chunked HTTPS response") from exc
                if chunk_length < 0 or received + chunk_length > max_bytes:
                    raise ValueError("HTTPS response exceeds the configured maximum size")
                if chunk_length == 0:
                    trailer_bytes = 0
                    while True:
                        trailer = await self._readline()
                        trailer_bytes += len(trailer)
                        if trailer_bytes > _MAX_HEADER_BYTES:
                            raise ValueError("HTTPS response trailers exceed the allowed size")
                        if trailer in (b"\r\n", b"\n", b""):
                            return
                remaining = chunk_length
                while remaining:
                    data = await self._read_exactly(min(chunk_size, remaining))
                    received += len(data)
                    remaining -= len(data)
                    yield data
                if await self._read_exactly(2) != b"\r\n":
                    raise ValueError("Invalid chunk terminator in HTTPS response")

        while declared_length is None or received < declared_length:
            remaining = max_bytes - received
            request_size = min(chunk_size, remaining + 1)
            data = await self._read(request_size)
            if not data:
                if declared_length is not None and received != declared_length:
                    raise ValueError("Truncated HTTPS response body")
                return
            if received + len(data) > max_bytes:
                raise ValueError("HTTPS response exceeds the configured maximum size")
            if declared_length is not None and received + len(data) > declared_length:
                raise ValueError("HTTPS response exceeds its Content-Length")
            received += len(data)
            yield data


async def open_https_response(url, allowed_host, deadline, headers=None):
    """Open an HTTPS GET, validating every redirect before connecting to it."""
    current_url = url
    request_headers = headers or {}
    for redirect_count in range(_MAX_REDIRECTS + 1):
        parsed = _validate_url(current_url, allowed_host)
        host = parsed.hostname
        port = parsed.port or 443
        target = parsed.path or "/"
        if parsed.query:
            target += "?" + parsed.query

        reader, writer = await _within_deadline(
            asyncio.open_connection(
                host,
                port,
                ssl=ssl.create_default_context(),
                server_hostname=host,
                limit=_MAX_HEADER_BYTES,
            ),
            deadline,
        )
        try:
            outgoing_headers = {
                "Host": host,
                "Connection": "close",
                "Accept-Encoding": "identity",
                **request_headers,
            }
            request = "GET {} HTTP/1.1\r\n".format(target)
            request += "".join("{}: {}\r\n".format(key, value) for key, value in outgoing_headers.items())
            request += "\r\n"
            writer.write(request.encode("ascii"))
            await _within_deadline(writer.drain(), deadline)

            header_bytes = 0
            status_line = await _within_deadline(reader.readline(), deadline)
            header_bytes += len(status_line)
            if not status_line.endswith(b"\r\n") or header_bytes > _MAX_HEADER_BYTES:
                raise ValueError("Invalid or oversized HTTPS status line")
            try:
                status_parts = status_line.decode("latin-1").rstrip("\r\n").split(" ", 2)
                if len(status_parts) < 2:
                    raise ValueError("Incomplete status line")
                protocol, status_text = status_parts[:2]
                status = int(status_text)
            except (ValueError, UnicodeDecodeError) as exc:
                raise ValueError("Invalid HTTPS status line") from exc
            if protocol not in ("HTTP/1.0", "HTTP/1.1"):
                raise ValueError("Unsupported HTTPS response protocol")

            response_headers = {}
            while True:
                line = await _within_deadline(reader.readline(), deadline)
                header_bytes += len(line)
                if header_bytes > _MAX_HEADER_BYTES or not line.endswith(b"\r\n"):
                    raise ValueError("Invalid or oversized HTTPS response headers")
                if line == b"\r\n":
                    break
                if line[:1] in (b" ", b"\t") or b":" not in line:
                    raise ValueError("Malformed HTTPS response header")
                key, value = line[:-2].split(b":", 1)
                key = key.decode("ascii").lower()
                value = value.decode("latin-1").strip()
                if key in response_headers:
                    if key == "content-length" and response_headers[key] != value:
                        raise ValueError("Conflicting HTTPS Content-Length headers")
                    response_headers[key] += "," + value
                else:
                    response_headers[key] = value

            if status in (301, 302, 303, 307, 308):
                location = response_headers.get("location")
                if not location:
                    raise ValueError("HTTPS redirect is missing a Location header")
                redirected_url = urljoin(current_url, location)
                _validate_url(redirected_url, allowed_host)
                writer.close()
                if redirect_count == _MAX_REDIRECTS:
                    raise ValueError("Too many HTTPS redirects")
                current_url = redirected_url
                continue

            return HTTPSResponse(
                current_url, status, response_headers, reader, writer, deadline
            )
        except BaseException:
            writer.close()
            raise

    raise ValueError("Too many HTTPS redirects")
