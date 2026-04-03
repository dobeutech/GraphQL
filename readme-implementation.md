# 🧠 Conversation Network Visualization

A comprehensive GraphQL-powered neural network visualization of your conversation history, featuring automatic topic clustering, semantic search, and interactive exploration.

## ✨ Features

- **Automatic Topic Discovery**: BERTopic + HDBSCAN clustering identifies conversation themes
- **Multi-dimensional Relationships**: Semantic, temporal, and causal connections between topics
- **Interactive Visualization**: D3.js force-directed graph with zoom, search, and filtering
- **Semantic Search**: Qdrant vector database enables similarity-based exploration
- **Intelligent Memory**: Mem0 integration for context-aware memory management
- **Real-time Updates**: GraphQL subscriptions for live visualization updates
- **Production Ready**: Docker Compose deployment with monitoring and scaling

## 🚀 Quick Start (5 Minutes)

### 1. Clone the Starter Template

```bash
git clone https://github.com/yourusername/conversation-network.git
cd conversation-network
```

Or create manually:

```bash
mkdir conversation-network && cd conversation-network
mkdir -p server client clustering nginx prometheus grafana
```

### 2. Copy the Code Files

Save each artifact to its respective directory:
- `server.js` → `server/server.js`
- `clustering_service.py` → `clustering/clustering_service.py`
- `conversation-network-viz.js` → `client/src/index.js`
- `docker-compose.yml` → `./docker-compose.yml`
- Package files → respective directories

### 3. Launch the Stack

```bash
# Start all services
docker-compose up -d

# Check status (wait for all "healthy")
docker-compose ps

# View logs
docker-compose logs -f
```

### 4. Initialize the System

```bash
# Create Qdrant collections
curl -X PUT 'http://localhost:6333/collections/conversation_embeddings' \
  -H 'Content-Type: application/json' \
  -d '{"vectors": {"size": 384, "distance": "Cosine"}}'
```

### 5. Access the Visualization

Open your browser to: **http://localhost:3000**

## 📊 Loading Your Conversation Data

### Option 1: Manual Import via GraphQL

Use the GraphQL Playground at http://localhost:4000/graphql:

```graphql
mutation ImportConversation {
  createQuery(input: {
    content: "How do I implement OAuth in Node.js?",
    userId: "user123",
    threadId: "thread456"
  }) {
    id
    response {
      id
    }
  }
}
```

### Option 2: Batch Import Script

Create `import.js`:

```javascript
const conversations = require('./your-conversation-export.json');

async function importAll() {
  for (const conv of conversations) {
    await fetch('http://localhost:4000/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `mutation { 
          createQuery(input: {
            content: "${conv.query}",
            userId: "default"
          }) { id }
        }`
      })
    });
  }
  
  // Trigger clustering
  await fetch('http://localhost:4000/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation { 
        runClustering { clustersCreated }
      }`
    })
  });
}

importAll();
```

## 🎮 Using the Visualization

### Controls
- **Drag nodes**: Reposition clusters
- **Click node**: View cluster details
- **Double-click**: Expand sub-clusters
- **Scroll**: Zoom in/out
- **Search**: Find specific topics
- **Filters**: Date range, similarity threshold
- **View modes**: Cluster, Temporal, Hierarchical

### Understanding the Network
- **Node size**: Number of messages in cluster
- **Node color**: Topic category
- **Edge thickness**: Relationship strength
- **Edge color**: Relationship type (semantic/temporal/causal)

## 🔧 Configuration

### Adjust Clustering Parameters

Edit clustering sensitivity in GraphQL:

```graphql
mutation ReconfigureClustering {
  runClustering(parameters: {
    minClusterSize: 3      # Smaller = more clusters
    minSamples: 2          # Lower = include more outliers
    metricType: "cosine"   # Similarity metric
  }) {
    clustersCreated
    silhouetteScore
  }
}
```

### Customize Visualization

Edit `client/src/index.js`:

```javascript
// Change colors
this.colorScale = d3.scaleOrdinal(d3.schemeCategory10);

// Adjust physics
this.simulation
  .force('charge', d3.forceManyBody().strength(-1000))  // Repulsion
  .force('link', d3.forceLink().distance(150));         // Link distance

// Change node sizes
this.sizeScale = d3.scaleLinear().range([10, 100]);
```

## 📈 Monitoring & Analytics

### Grafana Dashboard
Access at http://localhost:3001 (admin/admin)
- Cluster growth over time
- Query response times
- Memory usage metrics
- User activity patterns

### Neo4j Browser
Access at http://localhost:7474
- Direct Cypher queries
- Graph exploration
- Performance metrics

## 🐛 Troubleshooting

### Issue: Visualization is empty
```bash
# Check if data is loaded
curl http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query": "{ allClusters { id name } }"}'

# If empty, trigger clustering
curl http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query": "mutation { runClustering { clustersCreated } }"}'
```

### Issue: Clustering service timeout
```bash
# Increase timeout in server/server.js
const response = await fetch('http://clustering-service:8081/cluster', {
  timeout: 60000  // 60 seconds
});
```

### Issue: Memory errors
```bash
# Increase Docker memory
docker-compose down
# Edit docker-compose.yml memory limits
docker-compose up -d
```

## 🚢 Production Deployment

### 1. Use Environment Variables

Create `.env`:
```bash
NEO4J_PASSWORD=strong-password-here
QDRANT_API_KEY=your-api-key
JWT_SECRET=your-secret
DOMAIN=your-domain.com
```

### 2. Enable HTTPS

Update `nginx/nginx.conf` with SSL certificates.

### 3. Scale Services

```yaml
# docker-compose.prod.yml
services:
  graphql-server:
    deploy:
      replicas: 3
  clustering-service:
    deploy:
      replicas: 2
```

## 📚 API Reference

### GraphQL Endpoints

- **Queries**: `allClusters`, `topicCluster`, `semanticSearch`
- **Mutations**: `createQuery`, `runClustering`, `storeInQdrant`
- **Subscriptions**: `clusterUpdated`, `relationshipCreated`

### REST Endpoints

- **Clustering**: `POST /cluster` - Run clustering
- **Embeddings**: `POST /embeddings` - Generate embeddings
- **Health**: `GET /health` - Service health check

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Open pull request

## 📄 License

MIT License - See LICENSE file for details

## 🆘 Support

- **Issues**: GitHub Issues
- **Documentation**: `/docs` directory
- **Community**: Discord server

---

Built with ❤️ using GraphQL, Neo4j, Qdrant, and D3.js