// conversation-network-viz.js - Interactive D3.js visualization for conversation clusters
import * as d3 from 'd3';
import { ApolloClient, InMemoryCache, gql } from '@apollo/client';

class ConversationNetworkViz {
  constructor(containerId, graphqlEndpoint) {
    this.container = d3.select(`#${containerId}`);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.graphqlEndpoint = graphqlEndpoint;
    
    // Initialize Apollo Client
    this.apolloClient = new ApolloClient({
      uri: graphqlEndpoint,
      cache: new InMemoryCache({
        typePolicies: {
          TopicCluster: {
            keyFields: ['id'],
            fields: {
              relatedClusters: {
                merge: false
              }
            }
          }
        }
      })
    });
    
    // Visualization state
    this.nodes = [];
    this.links = [];
    this.simulation = null;
    this.zoom = null;
    
    // Color scales
    this.colorScale = d3.scaleOrdinal(d3.schemeSet3);
    this.sizeScale = d3.scaleLinear().range([20, 80]);
    
    // Initialize the visualization
    this.init();
  }
  
  init() {
    // Create SVG canvas
    this.svg = this.container.append('svg')
      .attr('width', this.width)
      .attr('height', this.height)
      .attr('class', 'network-canvas');
    
    // Add zoom behavior
    this.zoom = d3.zoom()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        this.g.attr('transform', event.transform);
      });
    
    this.svg.call(this.zoom);
    
    // Create main group for transformation
    this.g = this.svg.append('g')
      .attr('class', 'network-group');
    
    // Define arrow markers for directed edges
    this.defineMarkers();
    
    // Create groups for links and nodes
    this.linkGroup = this.g.append('g').attr('class', 'links');
    this.nodeGroup = this.g.append('g').attr('class', 'nodes');
    
    // Create tooltip
    this.tooltip = d3.select('body').append('div')
      .attr('class', 'network-tooltip')
      .style('opacity', 0)
      .style('position', 'absolute')
      .style('padding', '10px')
      .style('background', 'rgba(0, 0, 0, 0.8)')
      .style('color', 'white')
      .style('border-radius', '5px')
      .style('pointer-events', 'none');
    
    // Create control panel
    this.createControlPanel();
    
    // Initialize force simulation
    this.initSimulation();
  }
  
  defineMarkers() {
    const defs = this.svg.append('defs');
    
    // Define different arrow types for different relationship types
    const markerTypes = ['SEMANTIC', 'TEMPORAL', 'CAUSAL', 'HIERARCHICAL', 'MIXED'];
    const colors = ['#3498db', '#e74c3c', '#f39c12', '#2ecc71', '#9b59b6'];
    
    markerTypes.forEach((type, i) => {
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 25)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', colors[i]);
    });
  }
  
  initSimulation() {
    this.simulation = d3.forceSimulation()
      .force('link', d3.forceLink()
        .id(d => d.id)
        .distance(d => 100 / (d.combinedWeight || 1))
        .strength(d => d.combinedWeight || 0.5))
      .force('charge', d3.forceManyBody()
        .strength(-500)
        .distanceMax(500))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collision', d3.forceCollide()
        .radius(d => this.getNodeRadius(d) + 5))
      .on('tick', () => this.ticked());
  }
  
  createControlPanel() {
    const panel = d3.select('body').append('div')
      .attr('class', 'control-panel')
      .style('position', 'fixed')
      .style('top', '20px')
      .style('right', '20px')
      .style('padding', '20px')
      .style('background', 'white')
      .style('border-radius', '8px')
      .style('box-shadow', '0 2px 10px rgba(0,0,0,0.1)');
    
    // Title
    panel.append('h3').text('Network Controls');
    
    // Date range filter
    panel.append('div')
      .attr('class', 'filter-section')
      .html(`
        <label>Date Range:</label>
        <input type="date" id="startDate" />
        <input type="date" id="endDate" />
        <button onclick="this.applyDateFilter()">Apply</button>
      `);
    
    // Similarity threshold
    panel.append('div')
      .attr('class', 'filter-section')
      .html(`
        <label>Min Similarity: <span id="simValue">0.5</span></label>
        <input type="range" id="simThreshold" 
               min="0" max="1" step="0.1" value="0.5" 
               oninput="document.getElementById('simValue').textContent = this.value" />
      `);
    
    // View mode selector
    panel.append('div')
      .attr('class', 'view-section')
      .html(`
        <label>View Mode:</label>
        <select id="viewMode">
          <option value="cluster">Cluster View</option>
          <option value="temporal">Temporal View</option>
          <option value="hierarchical">Hierarchical View</option>
        </select>
      `);
    
    // Analytics display
    panel.append('div')
      .attr('class', 'analytics-section')
      .attr('id', 'analytics')
      .html('<h4>Network Analytics</h4><div id="analyticsContent"></div>');
    
    // Search box
    panel.append('div')
      .attr('class', 'search-section')
      .html(`
        <input type="text" id="searchBox" placeholder="Search clusters..." />
        <button onclick="this.searchClusters()">Search</button>
      `);
  }
  
  async loadData() {
    try {
      // Fetch clusters and relationships from GraphQL
      const { data } = await this.apolloClient.query({
        query: gql`
          query GetConversationNetwork($minSimilarity: Float!) {
            allClusters(limit: 100) {
              id
              name
              description
              keywords
              clusterScore
              messageCount
              temporalRange {
                start
                end
              }
              relatedClusters(minSimilarity: $minSimilarity) {
                id
                name
                clusterScore
              }
            }
            networkMetrics {
              totalNodes
              totalEdges
              avgDegree
              clusteringCoefficient
              modularity
            }
          }
        `,
        variables: {
          minSimilarity: parseFloat(document.getElementById('simThreshold')?.value || 0.5)
        }
      });
      
      // Process nodes
      this.nodes = data.allClusters.map(cluster => ({
        ...cluster,
        radius: this.sizeScale(cluster.messageCount),
        x: Math.random() * this.width,
        y: Math.random() * this.height
      }));
      
      // Process links
      this.links = [];
      data.allClusters.forEach(cluster => {
        cluster.relatedClusters?.forEach(related => {
          this.links.push({
            source: cluster.id,
            target: related.id,
            combinedWeight: related.clusterScore || 0.5,
            relationshipType: 'SEMANTIC' // Default, would be fetched from API
          });
        });
      });
      
      // Update analytics
      this.updateAnalytics(data.networkMetrics);
      
      // Update visualization
      this.updateVisualization();
      
    } catch (error) {
      console.error('Error loading data:', error);
      this.showError('Failed to load network data');
    }
  }
  
  updateVisualization() {
    // Update size scale domain
    const messageCounts = this.nodes.map(d => d.messageCount);
    this.sizeScale.domain([
      Math.min(...messageCounts),
      Math.max(...messageCounts)
    ]);
    
    // Update links
    const link = this.linkGroup.selectAll('.link')
      .data(this.links, d => `${d.source.id || d.source}-${d.target.id || d.target}`);
    
    link.exit().remove();
    
    const linkEnter = link.enter().append('line')
      .attr('class', 'link')
      .attr('stroke-width', d => Math.sqrt(d.combinedWeight * 10))
      .attr('stroke', d => this.getLinkColor(d.relationshipType))
      .attr('opacity', 0.6)
      .attr('marker-end', d => `url(#arrow-${d.relationshipType})`);
    
    // Update nodes
    const node = this.nodeGroup.selectAll('.node')
      .data(this.nodes, d => d.id);
    
    node.exit().remove();
    
    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .call(this.drag());
    
    // Add circles
    nodeEnter.append('circle')
      .attr('r', d => this.getNodeRadius(d))
      .attr('fill', d => this.colorScale(d.id))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .on('mouseover', (event, d) => this.showTooltip(event, d))
      .on('mouseout', () => this.hideTooltip())
      .on('click', (event, d) => this.showNodeDetails(d))
      .on('dblclick', (event, d) => this.expandNode(d));
    
    // Add labels
    nodeEnter.append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .text(d => d.name.length > 15 ? d.name.substring(0, 15) + '...' : d.name);
    
    // Update simulation
    this.simulation.nodes(this.nodes);
    this.simulation.force('link').links(this.links);
    this.simulation.alpha(1).restart();
  }
  
  ticked() {
    // Update link positions
    this.linkGroup.selectAll('.link')
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    
    // Update node positions
    this.nodeGroup.selectAll('.node')
      .attr('transform', d => `translate(${d.x},${d.y})`);
  }
  
  drag() {
    return d3.drag()
      .on('start', (event, d) => {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) this.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }
  
  getNodeRadius(d) {
    return Math.sqrt(d.messageCount || 10) * 3;
  }
  
  getLinkColor(type) {
    const colors = {
      'SEMANTIC': '#3498db',
      'TEMPORAL': '#e74c3c',
      'CAUSAL': '#f39c12',
      'HIERARCHICAL': '#2ecc71',
      'MIXED': '#9b59b6'
    };
    return colors[type] || '#95a5a6';
  }
  
  showTooltip(event, d) {
    this.tooltip.transition()
      .duration(200)
      .style('opacity', .9);
    
    this.tooltip.html(`
      <strong>${d.name}</strong><br/>
      Messages: ${d.messageCount}<br/>
      Score: ${d.clusterScore?.toFixed(3)}<br/>
      Keywords: ${d.keywords?.slice(0, 5).join(', ')}
    `)
      .style('left', (event.pageX + 10) + 'px')
      .style('top', (event.pageY - 28) + 'px');
  }
  
  hideTooltip() {
    this.tooltip.transition()
      .duration(500)
      .style('opacity', 0);
  }
  
  async showNodeDetails(node) {
    // Fetch detailed information about the node
    const { data } = await this.apolloClient.query({
      query: gql`
        query GetClusterDetails($id: ID!) {
          topicCluster(id: $id) {
            id
            name
            description
            keywords
            clusterScore
            messageCount
            queries(first: 5) {
              id
              content
              timestamp
            }
            responses(first: 5) {
              id
              content
              confidence
            }
            artifacts(first: 5) {
              id
              title
              artifactType
            }
            temporalRange {
              start
              end
            }
          }
        }
      `,
      variables: { id: node.id }
    });
    
    // Create detail panel
    this.createDetailPanel(data.topicCluster);
  }
  
  createDetailPanel(cluster) {
    // Remove existing panel if any
    d3.select('.detail-panel').remove();
    
    const panel = d3.select('body').append('div')
      .attr('class', 'detail-panel')
      .style('position', 'fixed')
      .style('left', '20px')
      .style('top', '20px')
      .style('width', '400px')
      .style('max-height', '80vh')
      .style('overflow-y', 'auto')
      .style('padding', '20px')
      .style('background', 'white')
      .style('border-radius', '8px')
      .style('box-shadow', '0 2px 10px rgba(0,0,0,0.2)');
    
    // Close button
    panel.append('button')
      .text('×')
      .style('float', 'right')
      .style('font-size', '24px')
      .style('border', 'none')
      .style('background', 'none')
      .style('cursor', 'pointer')
      .on('click', () => panel.remove());
    
    // Cluster information
    panel.append('h2').text(cluster.name);
    panel.append('p').text(cluster.description);
    
    // Keywords
    panel.append('h4').text('Keywords');
    panel.append('div')
      .attr('class', 'keywords')
      .selectAll('.keyword')
      .data(cluster.keywords)
      .enter().append('span')
      .attr('class', 'keyword')
      .style('display', 'inline-block')
      .style('margin', '2px')
      .style('padding', '4px 8px')
      .style('background', '#ecf0f1')
      .style('border-radius', '4px')
      .text(d => d);
    
    // Recent queries
    if (cluster.queries?.length > 0) {
      panel.append('h4').text('Recent Queries');
      const queryList = panel.append('ul');
      cluster.queries.forEach(query => {
        queryList.append('li')
          .style('margin', '5px 0')
          .text(query.content.substring(0, 100) + '...');
      });
    }
    
    // Temporal range
    if (cluster.temporalRange) {
      panel.append('h4').text('Time Range');
      panel.append('p').text(
        `From ${new Date(cluster.temporalRange.start).toLocaleDateString()} 
         to ${new Date(cluster.temporalRange.end).toLocaleDateString()}`
      );
    }
  }
  
  async expandNode(node) {
    // Fetch sub-clusters or related nodes
    const { data } = await this.apolloClient.query({
      query: gql`
        query ExpandCluster($id: ID!) {
          topicCluster(id: $id) {
            subClusters {
              id
              name
              messageCount
              clusterScore
            }
          }
        }
      `,
      variables: { id: node.id }
    });
    
    if (data.topicCluster.subClusters?.length > 0) {
      // Add sub-clusters to the visualization
      const newNodes = data.topicCluster.subClusters.map(sub => ({
        ...sub,
        x: node.x + (Math.random() - 0.5) * 100,
        y: node.y + (Math.random() - 0.5) * 100,
        parent: node.id
      }));
      
      const newLinks = newNodes.map(sub => ({
        source: node.id,
        target: sub.id,
        combinedWeight: 0.8,
        relationshipType: 'HIERARCHICAL'
      }));
      
      this.nodes = [...this.nodes, ...newNodes];
      this.links = [...this.links, ...newLinks];
      
      this.updateVisualization();
    }
  }
  
  updateAnalytics(metrics) {
    const content = d3.select('#analyticsContent');
    content.html(`
      <p>Total Nodes: <strong>${metrics.totalNodes}</strong></p>
      <p>Total Edges: <strong>${metrics.totalEdges}</strong></p>
      <p>Avg Degree: <strong>${metrics.avgDegree?.toFixed(2)}</strong></p>
      <p>Clustering: <strong>${metrics.clusteringCoefficient?.toFixed(3)}</strong></p>
      <p>Modularity: <strong>${metrics.modularity?.toFixed(3)}</strong></p>
    `);
  }
  
  async searchClusters() {
    const query = document.getElementById('searchBox').value;
    if (!query) return;
    
    const { data } = await this.apolloClient.query({
      query: gql`
        query SearchClusters($query: String!) {
          searchClusters(query: $query, limit: 10) {
            id
            name
            clusterScore
          }
        }
      `,
      variables: { query }
    });
    
    // Highlight search results
    const resultIds = new Set(data.searchClusters.map(c => c.id));
    
    this.nodeGroup.selectAll('.node')
      .style('opacity', d => resultIds.has(d.id) ? 1 : 0.2);
    
    this.linkGroup.selectAll('.link')
      .style('opacity', d => 
        resultIds.has(d.source.id || d.source) || 
        resultIds.has(d.target.id || d.target) ? 0.6 : 0.1
      );
  }
  
  async applyDateFilter() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    if (!startDate || !endDate) return;
    
    // Reload data with date filter
    await this.loadData({ startDate, endDate });
  }
  
  changeViewMode(mode) {
    switch(mode) {
      case 'temporal':
        this.applyTemporalLayout();
        break;
      case 'hierarchical':
        this.applyHierarchicalLayout();
        break;
      default:
        this.applyForceLayout();
    }
  }
  
  applyTemporalLayout() {
    // Position nodes along a timeline
    const timeExtent = d3.extent(this.nodes, d => 
      new Date(d.temporalRange?.start || Date.now())
    );
    
    const xScale = d3.scaleTime()
      .domain(timeExtent)
      .range([100, this.width - 100]);
    
    this.nodes.forEach(d => {
      d.fx = xScale(new Date(d.temporalRange?.start || Date.now()));
      d.fy = this.height / 2 + (Math.random() - 0.5) * 200;
    });
    
    this.simulation.alpha(0.3).restart();
  }
  
  applyHierarchicalLayout() {
    // Create hierarchical layout
    const root = d3.hierarchy({
      name: 'root',
      children: this.nodes.filter(n => !n.parent)
    });
    
    const treeLayout = d3.tree()
      .size([this.width - 200, this.height - 200]);
    
    treeLayout(root);
    
    root.descendants().forEach(d => {
      const node = this.nodes.find(n => n.name === d.data.name);
      if (node) {
        node.fx = d.x + 100;
        node.fy = d.y + 100;
      }
    });
    
    this.simulation.alpha(0.3).restart();
  }
  
  applyForceLayout() {
    // Reset to force-directed layout
    this.nodes.forEach(d => {
      d.fx = null;
      d.fy = null;
    });
    
    this.simulation.alpha(1).restart();
  }
  
  showError(message) {
    const error = d3.select('body').append('div')
      .attr('class', 'error-message')
      .style('position', 'fixed')
      .style('top', '50%')
      .style('left', '50%')
      .style('transform', 'translate(-50%, -50%)')
      .style('padding', '20px')
      .style('background', '#e74c3c')
      .style('color', 'white')
      .style('border-radius', '8px')
      .text(message);
    
    setTimeout(() => error.remove(), 5000);
  }
  
  // Public methods
  refresh() {
    this.loadData();
  }
  
  destroy() {
    this.simulation.stop();
    this.svg.remove();
    this.tooltip.remove();
    d3.select('.control-panel').remove();
    d3.select('.detail-panel').remove();
  }
}

// Initialize the visualization
document.addEventListener('DOMContentLoaded', () => {
  const viz = new ConversationNetworkViz('network-container', 'http://localhost:4000/graphql');
  viz.loadData();
  
  // Set up event listeners
  document.getElementById('viewMode')?.addEventListener('change', (e) => {
    viz.changeViewMode(e.target.value);
  });
  
  document.getElementById('simThreshold')?.addEventListener('change', () => {
    viz.loadData();
  });
  
  // Auto-refresh every 5 minutes
  setInterval(() => viz.refresh(), 300000);
  
  // Handle window resize
  window.addEventListener('resize', () => {
    viz.width = window.innerWidth;
    viz.height = window.innerHeight;
    viz.svg.attr('width', viz.width).attr('height', viz.height);
    viz.simulation.force('center', d3.forceCenter(viz.width / 2, viz.height / 2));
    viz.simulation.alpha(0.3).restart();
  });
});

export default ConversationNetworkViz;