import struct, zlib

def create_png(size, r, g, b):
    width = height = size
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'
        for x in range(width):
            cx, cy = width // 2, height // 2
            dx, dy = abs(x - cx), abs(y - cy)
            radius = max(dx, dy)
            if radius < size * 0.35:
                raw_data += bytes([r, g, b, 255])
            elif radius < size * 0.42:
                raw_data += bytes([min(r + 40, 255), min(g + 40, 255), min(b + 40, 255), 230])
            else:
                raw_data += bytes([0, 0, 0, 0])

    def chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw_data)) + chunk(b'IEND', b'')

for size in [16, 48, 128]:
    with open(f'/root/kakaHelper/icons/icon{size}.png', 'wb') as f:
        f.write(create_png(size, 74, 108, 247))
    print(f'Created icon{size}.png')
