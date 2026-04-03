# clustering_service.py - BERTopic + HDBSCAN clustering for conversation topics
from flask import Flask, request, jsonify
from bertopic import BERTopic
from sentence_transformers import SentenceTransformer
from sklearn.cluster import HDBSCAN
from sklearn.metrics import silhouette_score
import numpy as np
import umap
from typing import List, Dict, Any, Tuple
import logging
import os
from datetime import datetime
import json

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize models
sentence_model = SentenceTransformer('all-MiniLM-L6-v2')
umap_model = umap.UMAP(n_neighbors=15, n_components=5, metric='cosine', random_state=42)

class ConversationClusterer:
    """BERTopic-based clustering for conversation data."""
    
    def __init__(self, min_cluster_size: int = 5, min_samples: int = 3):
        """
        Initialize the clusterer with HDBSCAN parameters.
        
        Args:
            min_cluster_size: Minimum size of clusters
            min_samples: Minimum samples to form a cluster core
        """
        self.min_cluster_size = min_cluster_size
        self.min_samples = min_samples
        
        # Initialize HDBSCAN with optimal parameters for conversation data
        self.hdbscan_model = HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            metric='euclidean',
            cluster_selection_method='eom',
            prediction_data=True
        )
        
        # Initialize BERTopic with custom models
        self.topic_model = BERTopic(
            embedding_model=sentence_model,
            umap_model=umap_model,
            hdbscan_model=self.hdbscan_model,
            nr_topics='auto',
            calculate_probabilities=True,
            verbose=True
        )
    
    def cluster_conversations(self, 
                             texts: List[str], 
                             embeddings: np.ndarray = None,
                             metadata: List[Dict] = None) -> Dict[str, Any]:
        """
        Cluster conversation texts into topics.
        
        Args:
            texts: List of conversation texts
            embeddings: Pre-computed embeddings (optional)
            metadata: Additional metadata for each text
            
        Returns:
            Dictionary containing clustering results
        """
        if embeddings is None:
            logger.info("Generating embeddings...")
            embeddings = sentence_model.encode(texts, show_progress_bar=True)
        
        logger.info(f"Clustering {len(texts)} conversations...")
        
        # Fit BERTopic model
        topics, probabilities = self.topic_model.fit_transform(texts, embeddings)
        
        # Get topic information
        topic_info = self.topic_model.get_topic_info()
        
        # Calculate cluster centroids
        centroids = self._calculate_centroids(embeddings, topics)
        
        # Calculate silhouette score if there are clusters
        sil_score = 0
        if len(set(topics)) > 1:
            valid_indices = [i for i, t in enumerate(topics) if t != -1]
            if len(valid_indices) > 0:
                sil_score = silhouette_score(
                    embeddings[valid_indices], 
                    [topics[i] for i in valid_indices]
                )
        
        # Build cluster information
        clusters = []
        for topic_id in set(topics):
            if topic_id == -1:  # Skip noise
                continue
                
            # Get indices of documents in this cluster
            cluster_indices = [i for i, t in enumerate(topics) if t == topic_id]
            
            # Get top words for this topic
            topic_words = self.topic_model.get_topic(topic_id)
            keywords = [word for word, _ in topic_words[:10]]
            
            # Generate cluster name from top keywords
            cluster_name = self._generate_cluster_name(keywords, topic_id)
            
            # Calculate cluster score (average probability)
            cluster_score = np.mean([probabilities[i][topic_id] 
                                    for i in cluster_indices 
                                    if topic_id < len(probabilities[i])])
            
            clusters.append({
                'id': f"cluster_{topic_id}_{datetime.now().isoformat()}",
                'topicId': topic_id,
                'name': cluster_name,
                'description': f"Topic cluster with keywords: {', '.join(keywords[:5])}",
                'keywords': keywords,
                'clusterScore': float(cluster_score),
                'centroid': centroids[topic_id].tolist() if topic_id in centroids else [],
                'memberIds': [metadata[i]['id'] if metadata else str(i) 
                            for i in cluster_indices],
                'size': len(cluster_indices),
                'representativeTexts': self._get_representative_texts(
                    texts, cluster_indices, embeddings, centroids.get(topic_id)
                )
            })
        
        # Count noise points
        noise_count = sum(1 for t in topics if t == -1)
        
        return {
            'clusters': clusters,
            'noise': noise_count,
            'silhouetteScore': float(sil_score),
            'totalClusters': len(clusters),
            'topicModel': {
                'topics': topic_info.to_dict('records'),
                'hierarchicalStructure': self._build_hierarchy(clusters, embeddings, topics)
            }
        }
    
    def _calculate_centroids(self, embeddings: np.ndarray, labels: List[int]) -> Dict[int, np.ndarray]:
        """Calculate centroid for each cluster."""
        centroids = {}
        for label in set(labels):
            if label == -1:  # Skip noise
                continue
            cluster_embeddings = embeddings[np.array(labels) == label]
            centroids[label] = np.mean(cluster_embeddings, axis=0)
        return centroids
    
    def _generate_cluster_name(self, keywords: List[str], topic_id: int) -> str:
        """Generate a meaningful name for the cluster."""
        if len(keywords) >= 3:
            return f"{keywords[0].title()} & {keywords[1].title()}"
        elif len(keywords) > 0:
            return keywords[0].title()
        else:
            return f"Topic {topic_id}"
    
    def _get_representative_texts(self, 
                                 texts: List[str], 
                                 indices: List[int], 
                                 embeddings: np.ndarray,
                                 centroid: np.ndarray,
                                 top_k: int = 3) -> List[str]:
        """Get the most representative texts for a cluster."""
        if centroid is None or len(indices) == 0:
            return []
        
        # Calculate distances from centroid
        cluster_embeddings = embeddings[indices]
        distances = np.linalg.norm(cluster_embeddings - centroid, axis=1)
        
        # Get indices of closest texts
        closest_indices = np.argsort(distances)[:top_k]
        
        return [texts[indices[i]] for i in closest_indices]
    
    def _build_hierarchy(self, 
                        clusters: List[Dict], 
                        embeddings: np.ndarray,
                        topics: List[int]) -> Dict[str, Any]:
        """Build hierarchical structure of clusters."""
        if len(clusters) <= 1:
            return {'root': clusters}
        
        # Calculate pairwise similarities between cluster centroids
        centroids = np.array([c['centroid'] for c in clusters if c['centroid']])
        
        if len(centroids) < 2:
            return {'root': clusters}
        
        # Perform hierarchical clustering on centroids
        from scipy.cluster.hierarchy import dendrogram, linkage
        from scipy.spatial.distance import pdist
        
        # Calculate distance matrix
        distances = pdist(centroids, metric='cosine')
        
        # Perform hierarchical clustering
        linkage_matrix = linkage(distances, method='ward')
        
        # Build hierarchy structure
        hierarchy = {
            'linkageMatrix': linkage_matrix.tolist(),
            'clusters': clusters,
            'levels': self._extract_hierarchy_levels(linkage_matrix, clusters)
        }
        
        return hierarchy
    
    def _extract_hierarchy_levels(self, linkage_matrix, clusters, max_levels=3):
        """Extract hierarchical levels from linkage matrix."""
        from scipy.cluster.hierarchy import fcluster
        
        levels = []
        for level in range(1, min(max_levels + 1, len(clusters))):
            cluster_assignments = fcluster(linkage_matrix, level, criterion='maxclust')
            
            level_clusters = {}
            for i, assignment in enumerate(cluster_assignments):
                if assignment not in level_clusters:
                    level_clusters[assignment] = []
                level_clusters[assignment].append(clusters[i])
            
            levels.append({
                'level': level,
                'clusters': list(level_clusters.values())
            })
        
        return levels

class RelationshipCalculator:
    """Calculate relationships between conversation clusters."""
    
    @staticmethod
    def calculate_edge_weights(clusters: List[Dict], 
                              embeddings: Dict[str, np.ndarray],
                              temporal_data: Dict[str, datetime]) -> List[Dict]:
        """
        Calculate edge weights between clusters based on multiple factors.
        
        Args:
            clusters: List of cluster dictionaries
            embeddings: Dictionary mapping node IDs to embeddings
            temporal_data: Dictionary mapping node IDs to timestamps
            
        Returns:
            List of edge dictionaries with weights
        """
        edges = []
        
        for i, cluster_a in enumerate(clusters):
            for cluster_b in clusters[i+1:]:
                # Semantic similarity (60% weight)
                semantic_sim = RelationshipCalculator._cosine_similarity(
                    np.array(cluster_a['centroid']),
                    np.array(cluster_b['centroid'])
                )
                
                # Temporal proximity (30% weight)
                temporal_score = RelationshipCalculator._calculate_temporal_proximity(
                    cluster_a['memberIds'],
                    cluster_b['memberIds'],
                    temporal_data
                )
                
                # Frequency/co-occurrence (10% weight)
                frequency_score = RelationshipCalculator._calculate_cooccurrence(
                    cluster_a['memberIds'],
                    cluster_b['memberIds']
                )
                
                # Combined weight
                combined_weight = (0.6 * semantic_sim + 
                                 0.3 * temporal_score + 
                                 0.1 * frequency_score)
                
                if combined_weight > 0.5:  # Threshold for creating edge
                    edges.append({
                        'from': cluster_a['id'],
                        'to': cluster_b['id'],
                        'semanticSimilarity': float(semantic_sim),
                        'temporalProximity': float(temporal_score),
                        'frequencyWeight': float(frequency_score),
                        'combinedWeight': float(combined_weight),
                        'relationshipType': RelationshipCalculator._determine_relationship_type(
                            semantic_sim, temporal_score
                        )
                    })
        
        return edges
    
    @staticmethod
    def _cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors."""
        dot_product = np.dot(vec_a, vec_b)
        norm_a = np.linalg.norm(vec_a)
        norm_b = np.linalg.norm(vec_b)
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
        
        return dot_product / (norm_a * norm_b)
    
    @staticmethod
    def _calculate_temporal_proximity(ids_a: List[str], 
                                     ids_b: List[str],
                                     temporal_data: Dict[str, datetime]) -> float:
        """Calculate temporal proximity between two clusters."""
        if not temporal_data:
            return 0.0
        
        times_a = [temporal_data.get(id) for id in ids_a if id in temporal_data]
        times_b = [temporal_data.get(id) for id in ids_b if id in temporal_data]
        
        if not times_a or not times_b:
            return 0.0
        
        # Calculate average time difference
        avg_time_a = sum(t.timestamp() for t in times_a) / len(times_a)
        avg_time_b = sum(t.timestamp() for t in times_b) / len(times_b)
        
        time_diff_hours = abs(avg_time_a - avg_time_b) / 3600
        
        # Exponential decay based on time difference
        decay_rate = 0.01  # Adjust based on conversation cadence
        return np.exp(-decay_rate * time_diff_hours)
    
    @staticmethod
    def _calculate_cooccurrence(ids_a: List[str], ids_b: List[str]) -> float:
        """Calculate co-occurrence score based on shared context."""
        # This is a simplified version - in production, you'd look at
        # actual co-occurrence in conversation threads
        overlap = len(set(ids_a) & set(ids_b))
        total = len(set(ids_a) | set(ids_b))
        
        return overlap / total if total > 0 else 0.0
    
    @staticmethod
    def _determine_relationship_type(semantic_sim: float, temporal_score: float) -> str:
        """Determine the primary type of relationship."""
        if semantic_sim > 0.8:
            return 'SEMANTIC'
        elif temporal_score > 0.8:
            return 'TEMPORAL'
        elif semantic_sim > 0.6 and temporal_score > 0.6:
            return 'CAUSAL'
        else:
            return 'MIXED'

# API Endpoints
@app.route('/cluster', methods=['POST'])
def cluster_conversations():
    """API endpoint for clustering conversations."""
    try:
        data = request.json
        
        # Extract parameters
        texts = data.get('texts', [])
        embeddings = np.array(data.get('embeddings', [])) if data.get('embeddings') else None
        metadata = data.get('metadata', [])
        parameters = data.get('parameters', {})
        
        if not texts and embeddings is None:
            return jsonify({'error': 'Either texts or embeddings must be provided'}), 400
        
        # Initialize clusterer with parameters
        clusterer = ConversationClusterer(
            min_cluster_size=parameters.get('minClusterSize', 5),
            min_samples=parameters.get('minSamples', 3)
        )
        
        # Perform clustering
        result = clusterer.cluster_conversations(texts, embeddings, metadata)
        
        return jsonify(result)
    
    except Exception as e:
        logger.error(f"Clustering error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/embeddings', methods=['POST'])
def generate_embeddings():
    """API endpoint for generating embeddings."""
    try:
        data = request.json
        text = data.get('text', '')
        texts = data.get('texts', [])
        model_name = data.get('model', 'all-MiniLM-L6-v2')
        
        if model_name != 'all-MiniLM-L6-v2':
            # Load different model if specified
            model = SentenceTransformer(model_name)
        else:
            model = sentence_model
        
        if text:
            embedding = model.encode(text).tolist()
            return jsonify({'embedding': embedding})
        elif texts:
            embeddings = model.encode(texts).tolist()
            return jsonify({'embeddings': embeddings})
        else:
            return jsonify({'error': 'No text provided'}), 400
    
    except Exception as e:
        logger.error(f"Embedding generation error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/relationships', methods=['POST'])
def calculate_relationships():
    """API endpoint for calculating cluster relationships."""
    try:
        data = request.json
        
        clusters = data.get('clusters', [])
        embeddings = data.get('embeddings', {})
        temporal_data = data.get('temporalData', {})
        
        # Convert temporal data to datetime objects
        if temporal_data:
            temporal_data = {
                k: datetime.fromisoformat(v) if isinstance(v, str) else v
                for k, v in temporal_data.items()
            }
        
        # Convert embeddings to numpy arrays
        if embeddings:
            embeddings = {k: np.array(v) for k, v in embeddings.items()}
        
        edges = RelationshipCalculator.calculate_edge_weights(
            clusters, embeddings, temporal_data
        )
        
        return jsonify({'edges': edges})
    
    except Exception as e:
        logger.error(f"Relationship calculation error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/update-topics', methods=['POST'])
def update_topics():
    """API endpoint for updating topic model with new data."""
    try:
        data = request.json
        
        new_texts = data.get('texts', [])
        new_embeddings = np.array(data.get('embeddings', [])) if data.get('embeddings') else None
        
        # Load existing model or create new one
        # In production, you'd load from persistent storage
        clusterer = ConversationClusterer()
        
        # Update model with new data
        if new_embeddings is None:
            new_embeddings = sentence_model.encode(new_texts)
        
        # Partial fit for online learning (if supported)
        # For BERTopic, you might need to retrain or use incremental methods
        topics, _ = clusterer.topic_model.transform(new_texts, new_embeddings)
        
        return jsonify({
            'updatedTopics': topics.tolist(),
            'success': True
        })
    
    except Exception as e:
        logger.error(f"Topic update error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({'status': 'healthy', 'models_loaded': True})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8081))
    app.run(host='0.0.0.0', port=port, debug=False)