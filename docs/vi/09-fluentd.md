# 9. Fluentd Integration

## 9.1 Tong Quan

| Thuoc tinh | Gia tri |
|------------|---------|
| **Image** | `fluent/fluentd:v1.17-1` |
| **Container** | `log-guardian-fluentd` |
| **Chuc nang** | Doc log file backend, chuyen doi va gui den API ingest |
| **Source** | `fluentd/` |

Fluentd duoc su dung nhu mot log shipper de thu thap log tu file output cua backend va gui den endpoint ingest.

## 9.2 Cau Truc Thu Muc

```
fluentd/
├── docker-compose.yml    # Docker Compose configuration
└── fluent.conf           # Fluentd configuration
```

## 9.3 Docker Compose (`docker-compose.yml`)

```yaml
services:
  fluentd:
    image: fluent/fluentd:v1.17-1
    container_name: log-guardian-fluentd
    environment:
      - INGEST_API_KEY=${INGEST_API_KEY}
    volumes:
      - ./fluent.conf:/fluentd/etc/fluent.conf:ro
      - ../backend/run_out.txt:/fluentd/log/backend.log:ro
      - fluentd-buffer:/fluentd/log/buffer
    command: ["fluentd", "-c", "/fluentd/etc/fluent.conf", "-v"]

volumes:
  fluentd-buffer:
```

### Volumes

| Mount | Container Path | Mo ta |
|-------|---------------|-------|
| `fluent.conf` | `/fluentd/etc/fluent.conf` | File cau hinh (read-only) |
| `backend/run_out.txt` | `/fluentd/log/backend.log` | File log backend (read-only) |
| `fluentd-buffer` | `/fluentd/log/buffer` | Buffer directory (persistent) |

### Bien moi truong

| Bien | Mo ta |
|------|-------|
| `INGEST_API_KEY` | API key de xac thuc voi backend |

## 9.4 Cau Hinh Fluentd (`fluent.conf`)

### Source (Nguon)

```xml
<source>
  @type tail
  path /fluentd/log/backend.log
  pos_file /fluentd/log/backend.log.pos
  tag log.guardian.backend
  <parse>
    @type regexp
    expression /^(?<timestamp>[^\s]+)\s+(?<level>[A-Z]+)\s+(?<message>.*)$/
    time_key timestamp
    time_type string
  </parse>
</source>
```

- **Loai**: `tail` - doc file va theo doi thay doi
- **File**: `/fluentd/log/backend.log` (mount tu `backend/run_out.txt`)
- **Regex parse**: Tach `timestamp`, `level`, `message`
- **Tag**: `log.guardian.backend`

### Filter (Bo Loc)

```xml
<filter log.guardian.backend>
  @type record_transformer
  enable_ruby true
  <record>
    device_id fluentd-agent
    format plain
    timestamp ${time.to_i * 1000}
    message ${record["message"]}
  </record>
</filter>
```

Chuyen doi ban ghi de phu hop voi dinh dang ingest API:
- Them `device_id: fluentd-agent`
- Dat `format: plain`
- Chuyen doi timestamp sang Unix epoch milliseconds
- Giu nguyen message

### Output (Dau Ra)

```xml
<match log.guardian.backend>
  @type http
  endpoint http://host.docker.internal:9000/api/v1/logs/ingest/fluentd
  http_method post
  serializer json
  open_timeout 5
  read_timeout 10
  <headers>
    x-api-key ${ENV['INGEST_API_KEY']}
    Content-Type application/json
  </headers>
  <buffer>
    @type file
    path /fluentd/log/buffer/fluentd
    flush_interval 5s
    retry_max_interval 30
    retry_forever true
  </buffer>
</match>
```

- **Endpoint**: `http://host.docker.internal:9000/api/v1/logs/ingest/fluentd`
  - `host.docker.internal` cho phep truy cap host machine tu Docker container
- **Auth**: API key qua header `x-api-key`
- **Buffer**: File-based, flush moi 5 giay
- **Retry**: Retry vinh vien voi khoang cach toi da 30 giay

## 9.5 Khoi Dong

### Buoc 1: Cau hinh API key

```bash
export INGEST_API_KEY=your-api-key
```

### Buoc 2: Khoi dong container

```bash
cd fluentd
docker compose up -d
```

### Buoc 3: Kiem tra log Fluentd

```bash
docker logs -f log-guardian-fluentd
```

## 9.6 Dung Container

```bash
cd fluentd
docker compose down
```

Xoa ca buffer volume:

```bash
docker compose down -v
```

## 9.7 Xu Ly Su Co

| Van de | Nguyen nhan | Giai phap |
|--------|-------------|-----------|
| Container khong khoi dong | File log khong ton tai | Tao file `backend/run_out.txt` truoc |
| Khong gui duoc den backend | `host.docker.internal` khong resolve | Dung Docker Desktop hoac them host mapping |
| Loi xac thuc 401 | API key sai | Kiem tra `INGEST_API_KEY` |
| Buffer tang lien tuc | Backend khong nhan duoc request | Kiem tra backend `/health` |
| Khong doc duoc file log | Quyen truy cap file | Kiem tra permissions cua `run_out.txt` |

### Xem trang thai buffer

```bash
docker exec log-guardian-fluentd ls -la /fluentd/log/buffer/
```

### Xoa buffer va restart

```bash
docker compose down -v
docker compose up -d
```

## 9.8 Tuy Chinh

### Them nguon log khac

Them them block `<source>` trong `fluent.conf`:

```xml
<source>
  @type tail
  path /fluentd/log/app.log
  pos_file /fluentd/log/app.log.pos
  tag log.guardian.app
  <parse>
    @type json
  </parse>
</source>
```

### Thay doi flush interval

Chinh `flush_interval` trong block `<buffer>`:

```xml
<buffer>
  flush_interval 10s    # Tang len 10 giay
</buffer>
```

### Loc theo level

Them filter de chi gui log ERROR tro len:

```xml
<filter log.guardian.backend>
  @type grep
  <regexp>
    key level
    pattern /^(ERROR|FATAL|WARN)$/
  </regexp>
</filter>
```
