# Redis based queue system for NodeJS (V3.X)

## Project consist of 3 folders
1. Queue application
2. Consumer
3. Bull Visualizer (GUI)

## Documentation
[Link](https://github.com/OptimalBits/bull)

## Redis Docker container
`docker run -p 6379:6379 --name redis -d redis redis-server --appendonly yes --requirepass 123456`

## Log into Redis
`redis-cli -a 123456`

## Run Queue app
`pnpm start`

## Run consumer
`pnpm start`

## Run GUI
`pnpm start`
