import asyncio
import time

import pytest

from pyverify._http import HTTPSResponse


class FakeReader:
    def __init__(self, body=b"", lines=()):
        self.body = body
        self.position = 0
        self.lines = iter(lines)
        self.read_sizes = []
        self.read_exactly_sizes = []

    async def read(self, size):
        self.read_sizes.append(size)
        end = min(self.position + size, len(self.body))
        data = self.body[self.position : end]
        self.position = end
        return data

    async def readexactly(self, size):
        self.read_exactly_sizes.append(size)
        data = await self.read(size)
        if len(data) != size:
            raise asyncio.IncompleteReadError(data, size)
        return data

    async def readline(self):
        return next(self.lines)


class GeneratedReader:
    """A reader that generates bytes on demand instead of storing the body."""

    def __init__(self, total_size):
        self.total_size = total_size
        self.position = 0
        self.read_sizes = []

    async def read(self, size):
        self.read_sizes.append(size)
        amount = min(size, self.total_size - self.position)
        self.position += amount
        return b"x" * amount


class FakeWriter:
    def close(self):
        pass


def make_response(headers, reader):
    return HTTPSResponse(
        "https://files.pythonhosted.org/example.whl",
        200,
        headers,
        reader,
        FakeWriter(),
        time.monotonic() + 30,
    )


def test_iter_bytes_rejects_content_length_over_limit_before_reading():
    reader = FakeReader(body=b"abcde")
    response = make_response({"content-length": "5"}, reader)

    async def run():
        return [chunk async for chunk in response.iter_bytes(2, 4)]

    with pytest.raises(ValueError, match="exceeds the configured maximum"):
        asyncio.run(run())
    assert reader.read_sizes == []


def test_iter_bytes_rejects_chunked_body_over_limit():
    reader = FakeReader(body=b"abc\r\nde\r\n", lines=[b"3\r\n", b"2\r\n"])
    response = make_response({"transfer-encoding": "chunked"}, reader)

    async def run():
        return [chunk async for chunk in response.iter_bytes(8, 4)]

    with pytest.raises(ValueError, match="exceeds the configured maximum"):
        asyncio.run(run())
    # It reads the first chunk and terminator, then rejects the next size line.
    assert reader.read_exactly_sizes == [3, 2]
    assert reader.position == 5


def test_iter_bytes_rejects_truncated_content_length_body():
    reader = FakeReader(body=b"abc")
    response = make_response({"content-length": "5"}, reader)

    async def run():
        return [chunk async for chunk in response.iter_bytes(2, 10)]

    with pytest.raises(ValueError, match="Truncated HTTPS response body"):
        asyncio.run(run())


def test_iter_bytes_accepts_body_exactly_at_limit():
    reader = FakeReader(body=b"abcdef")
    response = make_response({"content-length": "6"}, reader)

    async def run():
        return [chunk async for chunk in response.iter_bytes(2, 6)]

    assert asyncio.run(run()) == [b"ab", b"cd", b"ef"]
    assert reader.position == 6


def test_iter_bytes_yields_bounded_chunks_incrementally():
    total_size = 100_000
    chunk_size = 1024
    reader = GeneratedReader(total_size)
    response = make_response({}, reader)

    async def run():
        iterator = response.iter_bytes(chunk_size, total_size)
        first_chunk = await iterator.__anext__()
        # The transport has only read the first chunk when it yields it.
        assert len(first_chunk) == chunk_size
        assert reader.position == chunk_size

        bytes_yielded = len(first_chunk)
        chunk_count = 1
        async for chunk in iterator:
            assert len(chunk) <= chunk_size
            bytes_yielded += len(chunk)
            chunk_count += 1
        return bytes_yielded, chunk_count

    bytes_yielded, chunk_count = asyncio.run(run())

    assert bytes_yielded == total_size
    assert chunk_count == total_size // chunk_size + 1
    assert max(reader.read_sizes) <= chunk_size + 1
