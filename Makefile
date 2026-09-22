.PHONY: dev seed smoke demo tunnel

dev:        ## run the app server with --watch (http://localhost:8787)
	npm run dev

seed:       ## seed the demo target repo (requires gh auth)
	npm run seed

smoke:      ## end-to-end smoke: brief → worker → callback → consent → receipt
	npm run smoke

demo tunnel: ## app server + public cloudflared tunnel; prints the live URL
	./scripts/start-demo.sh
