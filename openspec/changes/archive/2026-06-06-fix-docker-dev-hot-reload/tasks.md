## 1. Environment Configuration

- [x] 1.1 Add `FMD_ADAPTER_SOURCE` variable to `.env.example` with comment explaining the variable
- [x] 1.2 Set default value to `${PWD}` for current directory

## 2. Docker Compose Override

- [x] 2.1 Update `docker-compose.dev.yml` to use `${FMD_ADAPTER_SOURCE}` environment variable in volume mount
- [x] 2.2 Verify the volume mount syntax is correct for docker compose

## 3. README Documentation

- [x] 3.1 Review and correct Docker workflow commands in README
- [x] 3.2 Ensure docker compose syntax matches actual usage (`-f docker-compose.yml -f docker-compose.dev.yml`)
- [x] 3.3 Add Docker troubleshooting section with common issues:
  - Volume mount not reflecting changes
  - Port already in use
  - Docker permission errors

## 4. Verification

- [x] 4.1 Test `docker compose config` to verify the override merges correctly
- [x] 4.2 Verify `.env.example` contains all required variables
