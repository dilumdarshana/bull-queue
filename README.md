# Redis based queue system for NodeJS

## Project consist of 3 folders
1. Queue application
2. Consumer
3. Bull Visualizer (GUI)

## Documentation
`https://github.com/OptimalBits/bull`

## Redis Docker container
`docker run -p 6379:6379 --name redis -d redis redis-server --appendonly yes --requirepass 123456`

## Log into Redis
`redis-cli -a 123456`

## Run Queue app
`node index.js`

## Run consumer
`node index.js`

## Run GUI
`node index.js`