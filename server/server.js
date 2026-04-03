// server.js - Main Apollo GraphQL Server with Neo4j and Qdrant integration
import 'dotenv/config';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { Neo4jGraphQL } from '@neo4j/graphql';
import neo4j from 'neo4j-driver';
import { QdrantClient } from '@qdrant/js-client-rest';
import DataLoader from 'dataloader';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

// Initialize connections
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', process.env.NEO4J_PASSWORD || 'password')
);

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL || 'http://localhost:6333',
});

// Mem0 memory layer — disabled until a JS-compatible client is available.
// The Python Mem0 SDK can be accessed via the clustering service if needed.
const memory = null;

// GraphQL Type Definitions
const typeDefs = `#graphql
  type TopicCluster {
    id: ID!
    name: String!
    description: String
    keywords: [String!]!
    clusterScore: Float!
    centroid: [Float!]!
    createdAt: DateTime!
    updatedAt: DateTime!
    embedding: [Float!]
    
    # Relationships
    queries: [QueryNode!]! @relationship(type: "CONTAINS_QUERY", direction: OUT)
    responses: [ResponseNode!]! @relationship(type: "CONTAINS_RESPONSE", direction: OUT)
    artifacts: [ArtifactNode!]! @relationship(type: "CONTAINS_ARTIFACT", direction: OUT)
    sources: [SourceNode!]! @relationship(type: "REFERENCES_SOURCE", direction: OUT)
    
    # Cluster relationships with weights
    relatedClusters: [TopicCluster!]! @relationship(type: "RELATED_TO", direction: OUT, properties: "ClusterRelationship")
    parentCluster: TopicCluster @relationship(type: "SUBCATEGORY_OF", direction: OUT)
    subClusters: [TopicCluster!]! @relationship(type: "SUBCATEGORY_OF", direction: IN)
    
    # Computed fields
    messageCount: Int! @cypher(statement: """
      MATCH (this)-[:CONTAINS_QUERY|CONTAINS_RESPONSE]->(n)
      RETURN count(n) AS count
    """, columnName: "count")
  }

  type QueryNode {
    id: ID!
    content: String!
    timestamp: DateTime!
    threadId: ID!
    userId: String!
    intent: String
    entities: [Entity!]!
    createdAt: DateTime!
    updatedAt: DateTime!
    embedding: [Float!]
    
    # Direct relationships
    response: ResponseNode! @relationship(type: "ANSWERED_BY", direction: OUT)
    previousQuery: QueryNode @relationship(type: "FOLLOWS", direction: OUT)
    nextQuery: QueryNode @relationship(type: "FOLLOWS", direction: IN)
    cluster: TopicCluster! @relationship(type: "CONTAINS_QUERY", direction: IN)
    
    # Semantic relationships
    similarQueries(threshold: Float = 0.7): [SimilarQuery!]!
  }

  type ResponseNode {
    id: ID!
    content: String!
    timestamp: DateTime!
    confidence: Float
    modelVersion: String
    tokenCount: Int
    createdAt: DateTime!
    updatedAt: DateTime!
    embedding: [Float!]
    
    # Direct relationships
    query: QueryNode! @relationship(type: "ANSWERED_BY", direction: IN)
    artifacts: [ArtifactNode!]! @relationship(type: "GENERATED", direction: OUT)
    sources: [SourceNode!]! @relationship(type: "CITED", direction: OUT)
    cluster: TopicCluster! @relationship(type: "CONTAINS_RESPONSE", direction: IN)
    
    # Quality metrics
    qualityScore: Float
    relevanceScore: Float
  }

  type ArtifactNode {
    id: ID!
    artifactType: ArtifactType!
    content: String!
    format: String!
    language: String
    title: String
    size: Int
    createdAt: DateTime!
    updatedAt: DateTime!
    embedding: [Float!]
    
    # Relationships
    generatedBy: ResponseNode! @relationship(type: "GENERATED", direction: IN)
    derivedFrom: [ArtifactNode!]! @relationship(type: "DERIVED_FROM", direction: OUT)
    versions: [ArtifactNode!]! @relationship(type: "VERSION_OF", direction: OUT)
    cluster: TopicCluster! @relationship(type: "CONTAINS_ARTIFACT", direction: IN)
    
    # Metadata
    usageCount: Int!
    lastUsed: DateTime
  }

  type SourceNode {
    id: ID!
    url: String!
    title: String!
    author: String
    publishedDate: DateTime
    domain: String!
    sourceType: SourceType!
    createdAt: DateTime!
    updatedAt: DateTime!
    embedding: [Float!]
    
    # Relationships
    citedBy: [ResponseNode!]! @relationship(type: "CITED", direction: IN)
    clusters: [TopicCluster!]! @relationship(type: "REFERENCES_SOURCE", direction: IN)
    
    # Metrics
    citationCount: Int!
    relevanceScore: Float!
    trustScore: Float
  }

  type Entity {
    type: String!
    value: String!
    confidence: Float!
  }

  type ClusterRelationship @relationshipProperties {
    semanticSimilarity: Float!
    temporalProximity: Float!
    frequencyWeight: Float!
    combinedWeight: Float!
    relationshipType: RelationType!
  }

  type SimilarQuery {
    query: QueryNode!
    similarity: Float!
    sharedEntities: [Entity!]!
  }

  type TimeRange {
    start: DateTime!
    end: DateTime!
  }

  enum ArtifactType {
    CODE
    DOCUMENT
    IMAGE
    VISUALIZATION
    DATA
    CONFIGURATION
  }

  enum SourceType {
    WEB
    DOCUMENTATION
    RESEARCH_PAPER
    BOOK
    API_REFERENCE
    USER_PROVIDED
  }

  enum RelationType {
    SEMANTIC
    TEMPORAL
    CAUSAL
    HIERARCHICAL
  }

  # Input types for mutations
  input CreateQueryInput {
    content: String!
    threadId: ID
    userId: String!
    intent: String
    entities: [EntityInput!]
  }

  input EntityInput {
    type: String!
    value: String!
    confidence: Float!
  }

  input ClusteringParameters {
    minClusterSize: Int = 5
    minSamples: Int = 3
    metricType: String = "cosine"
    clusterSelectionEpsilon: Float = 0.0
  }

  # Query type
  type Query {
    # Basic node queries
    topicCluster(id: ID!): TopicCluster
    query(id: ID!): QueryNode
    response(id: ID!): ResponseNode
    artifact(id: ID!): ArtifactNode
    source(id: ID!): SourceNode
    
    # Cluster operations
    allClusters(
      limit: Int = 20
      offset: Int = 0
      sortBy: ClusterSortField = MESSAGE_COUNT
      order: SortOrder = DESC
    ): [TopicCluster!]!
    
    # Search operations
    searchClusters(
      query: String!
      minSimilarity: Float = 0.6
      limit: Int = 10
    ): [TopicCluster!]!
    
    # Semantic search in Qdrant
    semanticSearch(
      query: String!
      collection: String!
      limit: Int = 10
      filters: SearchFilters
    ): SearchResults!
    
    # Temporal queries
    conversationTimeline(
      startDate: DateTime!
      endDate: DateTime!
      granularity: TimeGranularity = DAY
    ): [TimelineEntry!]!
    
    # Graph traversal
    shortestPath(
      fromId: ID!
      toId: ID!
      maxHops: Int = 5
    ): Path
    
    # Analytics
    networkMetrics: NetworkAnalytics!
  }

  # Mutation type
  type Mutation {
    # Create operations
    createQuery(input: CreateQueryInput!): QueryNode!
    
    # Clustering operations
    runClustering(
      parameters: ClusteringParameters
    ): ClusteringResult!
    
    updateClusterEmbeddings: UpdateResult!
    
    # Vector operations
    storeInQdrant(
      nodeId: ID!
      collection: String!
    ): VectorStorageResult!
    
    # Memory operations
    saveToMem0(
      content: String!
      userId: String!
      metadata: JSON
    ): MemoryResult!
    
    # Graph operations
    calculateRelationships(
      threshold: Float = 0.5
    ): RelationshipCalculationResult!
  }

  # Additional types
  type SearchResults {
    results: [SearchResult!]!
    totalCount: Int!
    nextToken: String
  }

  type SearchResult {
    id: ID!
    content: String!
    score: Float!
    metadata: JSON!
  }

  type TimelineEntry {
    date: DateTime!
    queryCount: Int!
    responseCount: Int!
    artifactCount: Int!
    dominantCluster: TopicCluster
  }

  type Path {
    nodes: [ID!]!
    edges: [Edge!]!
    totalWeight: Float!
  }

  type Edge {
    from: ID!
    to: ID!
    weight: Float!
    type: String!
  }

  type NetworkAnalytics {
    totalNodes: Int!
    totalEdges: Int!
    avgDegree: Float!
    clusteringCoefficient: Float!
    modularity: Float!
    topClusters: [TopicCluster!]!
  }

  type ClusteringResult {
    clustersCreated: Int!
    noisePoints: Int!
    executionTime: Float!
    silhouetteScore: Float!
  }

  type VectorStorageResult {
    success: Boolean!
    vectorId: String!
    collection: String!
  }

  type MemoryResult {
    success: Boolean!
    memoryId: String!
  }

  type RelationshipCalculationResult {
    relationshipsCreated: Int!
    relationshipsUpdated: Int!
    executionTime: Float!
  }

  type UpdateResult {
    nodesUpdated: Int!
    success: Boolean!
  }

  enum ClusterSortField {
    MESSAGE_COUNT
    CREATION_DATE
    CLUSTER_SCORE
    NAME
  }

  enum SortOrder {
    ASC
    DESC
  }

  enum TimeGranularity {
    HOUR
    DAY
    WEEK
    MONTH
  }

  input SearchFilters {
    startDate: DateTime
    endDate: DateTime
    clusters: [ID!]
    nodeTypes: [String!]
    minScore: Float
  }

  scalar JSON
`;

// Create DataLoaders for batching
const createDataLoaders = (session) => ({
  clusterLoader: new DataLoader(async (ids) => {
    const result = await session.run(
      'MATCH (c:TopicCluster) WHERE c.id IN $ids RETURN c',
      { ids }
    );
    return ids.map(id => 
      result.records.find(r => r.get('c').properties.id === id)?.get('c').properties
    );
  }),
  
  embeddingLoader: new DataLoader(async (ids) => {
    const points = await qdrantClient.retrieve('conversation_embeddings', {
      ids,
      with_vector: true
    });
    return ids.map(id => points.find(p => p.id === id)?.vector);
  })
});

// Custom resolvers for advanced operations
const resolvers = {
  Query: {
    semanticSearch: async (_, { query, collection, limit, filters }) => {
      // Generate embedding for query
      const queryEmbedding = await generateEmbedding(query);
      
      // Build Qdrant filter
      const qdrantFilter = buildQdrantFilter(filters);
      
      // Search in Qdrant
      const results = await qdrantClient.search(collection, {
        vector: queryEmbedding,
        limit,
        filter: qdrantFilter,
        with_payload: true
      });
      
      return {
        results: results.map(r => ({
          id: r.id,
          content: r.payload.content,
          score: r.score,
          metadata: r.payload
        })),
        totalCount: results.length
      };
    },
    
    networkMetrics: async (_, __, { dataSources }) => {
      const session = driver.session();
      try {
        // Run multiple analytics queries in parallel
        const [nodeCount, edgeCount, avgDegree, clustering, modularity] = await Promise.all([
          session.run('MATCH (n) RETURN count(n) as count'),
          session.run('MATCH ()-[r]->() RETURN count(r) as count'),
          session.run(`
            MATCH (n)
            OPTIONAL MATCH (n)-[r]-()
            WITH n, count(r) as degree
            RETURN avg(degree) as avgDegree
          `),
          session.run(`
            CALL gds.localClusteringCoefficient.stream('conversation-network')
            YIELD nodeId, localClusteringCoefficient
            RETURN avg(localClusteringCoefficient) as coefficient
          `),
          session.run(`
            CALL gds.modularity.stream('conversation-network')
            YIELD modularity
            RETURN modularity
          `)
        ]);
        
        return {
          totalNodes: nodeCount.records[0].get('count').toNumber(),
          totalEdges: edgeCount.records[0].get('count').toNumber(),
          avgDegree: avgDegree.records[0].get('avgDegree'),
          clusteringCoefficient: clustering.records[0]?.get('coefficient') || 0,
          modularity: modularity.records[0]?.get('modularity') || 0,
          topClusters: await getTopClusters(session)
        };
      } finally {
        await session.close();
      }
    }
  },
  
  Mutation: {
    runClustering: async (_, { parameters }) => {
      const startTime = Date.now();
      
      // Fetch all embeddings from Qdrant
      const embeddings = await fetchAllEmbeddings();
      
      // Run HDBSCAN clustering
      const clusteringResult = await runHDBSCAN(embeddings, parameters);
      
      // Create cluster nodes in Neo4j
      const session = driver.session();
      try {
        for (const cluster of clusteringResult.clusters) {
          await session.run(`
            CREATE (c:TopicCluster {
              id: $id,
              name: $name,
              description: $description,
              keywords: $keywords,
              clusterScore: $score,
              centroid: $centroid,
              createdAt: datetime(),
              updatedAt: datetime()
            })
          `, cluster);
          
          // Create relationships to contained nodes
          await session.run(`
            MATCH (c:TopicCluster {id: $clusterId})
            MATCH (n) WHERE n.id IN $nodeIds
            CREATE (c)-[:CONTAINS_QUERY|CONTAINS_RESPONSE|CONTAINS_ARTIFACT]->(n)
          `, {
            clusterId: cluster.id,
            nodeIds: cluster.memberIds
          });
        }
        
        // Calculate inter-cluster relationships
        await calculateClusterRelationships(session);
        
        return {
          clustersCreated: clusteringResult.clusters.length,
          noisePoints: clusteringResult.noise,
          executionTime: (Date.now() - startTime) / 1000,
          silhouetteScore: clusteringResult.silhouetteScore
        };
      } finally {
        await session.close();
      }
    },
    
    storeInQdrant: async (_, { nodeId, collection }) => {
      const session = driver.session();
      try {
        // Fetch node from Neo4j
        const result = await session.run(
          'MATCH (n) WHERE n.id = $id RETURN n',
          { id: nodeId }
        );
        
        const node = result.records[0].get('n').properties;
        
        // Generate embedding if not exists
        const embedding = node.embedding || await generateEmbedding(node.content);
        
        // Store in Qdrant
        await qdrantClient.upsert(collection, {
          points: [{
            id: nodeId,
            vector: embedding,
            payload: {
              content: node.content,
              type: node.labels?.[0],
              timestamp: node.timestamp,
              metadata: node
            }
          }]
        });
        
        return {
          success: true,
          vectorId: nodeId,
          collection
        };
      } finally {
        await session.close();
      }
    },
    
    saveToMem0: async (_, { content, userId, metadata }) => {
      try {
        const result = await memory.add(
          [{ role: "user", content }],
          userId,
          metadata
        );
        
        return {
          success: true,
          memoryId: result.id
        };
      } catch (error) {
        console.error('Mem0 storage error:', error);
        return {
          success: false,
          memoryId: null
        };
      }
    },
    
    calculateRelationships: async (_, { threshold }) => {
      const startTime = Date.now();
      const session = driver.session();
      
      try {
        // Calculate semantic and temporal relationships
        const result = await session.run(`
          MATCH (c1:TopicCluster), (c2:TopicCluster)
          WHERE c1.id < c2.id
          WITH c1, c2,
            gds.similarity.cosine(c1.centroid, c2.centroid) as semanticSim,
            abs(duration.between(c1.createdAt, c2.createdAt).days) as daysDiff
          WITH c1, c2, semanticSim,
            CASE 
              WHEN daysDiff < 1 THEN 1.0
              WHEN daysDiff < 7 THEN 0.8
              WHEN daysDiff < 30 THEN 0.5
              ELSE 0.3
            END as temporalProx,
            0.1 as freqWeight // Placeholder for frequency calculation
          WITH c1, c2,
            semanticSim,
            temporalProx,
            freqWeight,
            (0.6 * semanticSim + 0.3 * temporalProx + 0.1 * freqWeight) as combinedWeight
          WHERE combinedWeight > $threshold
          MERGE (c1)-[r:RELATED_TO]-(c2)
          SET r.semanticSimilarity = semanticSim,
              r.temporalProximity = temporalProx,
              r.frequencyWeight = freqWeight,
              r.combinedWeight = combinedWeight,
              r.relationshipType = CASE
                WHEN semanticSim > 0.8 THEN 'SEMANTIC'
                WHEN temporalProx > 0.8 THEN 'TEMPORAL'
                ELSE 'MIXED'
              END
          RETURN count(r) as relationships
        `, { threshold });
        
        return {
          relationshipsCreated: result.records[0].get('relationships').toNumber(),
          relationshipsUpdated: 0,
          executionTime: (Date.now() - startTime) / 1000
        };
      } finally {
        await session.close();
      }
    }
  },
  
  TopicCluster: {
    relatedClusters: async (parent, args, context) => {
      const { dataSources } = context;
      const session = driver.session();
      
      try {
        const result = await session.run(`
          MATCH (c:TopicCluster {id: $id})-[r:RELATED_TO]-(related:TopicCluster)
          WHERE r.combinedWeight > $minSimilarity
          RETURN related, r
          ORDER BY r.combinedWeight DESC
          LIMIT 10
        `, { 
          id: parent.id,
          minSimilarity: args.minSimilarity || 0.7
        });
        
        return result.records.map(record => ({
          cluster: record.get('related').properties,
          relationship: record.get('r').properties
        }));
      } finally {
        await session.close();
      }
    }
  }
};

// Helper functions
async function generateEmbedding(text) {
  // Use sentence-transformers or OpenAI embeddings
  // This is a placeholder - implement with your preferred embedding model
  const response = await fetch('http://localhost:8080/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model: 'all-MiniLM-L6-v2' })
  });
  return (await response.json()).embedding;
}

function buildQdrantFilter(filters) {
  if (!filters) return null;
  
  const conditions = [];
  
  if (filters.startDate) {
    conditions.push({
      key: 'timestamp',
      range: { gte: new Date(filters.startDate).toISOString() }
    });
  }
  
  if (filters.endDate) {
    conditions.push({
      key: 'timestamp',
      range: { lte: new Date(filters.endDate).toISOString() }
    });
  }
  
  if (filters.clusters?.length) {
    conditions.push({
      key: 'cluster_id',
      match: { any: filters.clusters }
    });
  }
  
  if (filters.nodeTypes?.length) {
    conditions.push({
      key: 'type',
      match: { any: filters.nodeTypes }
    });
  }
  
  return conditions.length > 0 ? { must: conditions } : null;
}

async function fetchAllEmbeddings() {
  const limit = 100;
  let offset = 0;
  const allEmbeddings = [];
  
  while (true) {
    const batch = await qdrantClient.scroll('conversation_embeddings', {
      limit,
      offset,
      with_vector: true
    });
    
    if (batch.points.length === 0) break;
    
    allEmbeddings.push(...batch.points);
    offset += limit;
  }
  
  return allEmbeddings;
}

async function runHDBSCAN(embeddings, parameters) {
  // This would call your Python HDBSCAN service
  // or use a JavaScript implementation
  const response = await fetch('http://localhost:8081/cluster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeddings, parameters })
  });
  
  return await response.json();
}

async function calculateClusterRelationships(session) {
  // Implementation for calculating inter-cluster relationships
  // Based on semantic similarity, temporal proximity, and frequency
}

async function getTopClusters(session, limit = 5) {
  const result = await session.run(`
    MATCH (c:TopicCluster)
    OPTIONAL MATCH (c)-[:CONTAINS_QUERY|CONTAINS_RESPONSE]->(n)
    WITH c, count(n) as messageCount
    RETURN c
    ORDER BY messageCount DESC
    LIMIT $limit
  `, { limit });
  
  return result.records.map(r => r.get('c').properties);
}

// Initialize Neo4j GraphQL
const neoSchema = new Neo4jGraphQL({ typeDefs, driver, resolvers });

// Create Apollo Server with Express for health endpoint
async function startServer() {
  const schema = await neoSchema.getSchema();
  const app = express();
  const httpServer = createServer(app);

  const server = new ApolloServer({
    schema,
  });

  await server.start();

  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/health', async (_req, res) => {
    const checks = { neo4j: false, qdrant: false, clustering: false };
    try {
      const session = driver.session();
      await session.run('RETURN 1');
      await session.close();
      checks.neo4j = true;
    } catch { /* neo4j down */ }
    try {
      await qdrantClient.getCollections();
      checks.qdrant = true;
    } catch { /* qdrant down */ }
    try {
      const r = await fetch(`${process.env.CLUSTERING_SERVICE_URL || 'http://localhost:8081'}/health`);
      checks.clustering = r.ok;
    } catch { /* clustering down */ }

    const healthy = checks.neo4j && checks.qdrant;
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'healthy' : 'degraded', checks });
  });

  // GraphQL middleware
  app.use('/graphql', expressMiddleware(server, {
    context: async ({ req }) => ({
      dataSources: { neo4j: driver, qdrant: qdrantClient },
      loaders: createDataLoaders(driver.session()),
    }),
  }));

  const port = parseInt(process.env.PORT || '4000', 10);
  httpServer.listen(port, () => {
    console.log(`GraphQL Server ready at http://localhost:${port}/graphql`);
    console.log(`Health check at http://localhost:${port}/health`);
  });
}

startServer().catch(console.error);

export { typeDefs, resolvers, driver, qdrantClient };