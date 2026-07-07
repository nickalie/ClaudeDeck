.PHONY: lint test

lint:
	ruff check .

test:
	python -m pytest tests/ -v
