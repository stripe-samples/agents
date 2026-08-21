.PHONY: install run lint format typecheck build ci

install:
	pnpm install

run:
	pnpm run dev

lint:
	pnpm exec biome check .

format:
	pnpm exec biome check --write .

typecheck:
	pnpm run typecheck

build:
	pnpm run build

ci: install lint typecheck build
