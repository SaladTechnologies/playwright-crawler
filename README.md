# playwright-crawler
A webcrawler worker built with playwright

## Docker

```
saladtechnologies/playwright-crawler:latest
```

## Build

```bash
docker buildx build \
-t saladtechnologies/playwright-crawler:latest \
--platform linux/amd64 \
--output type=docker \
--provenance=false \
.
```