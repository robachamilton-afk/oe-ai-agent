/**
 * Project Database Wrapper
 * 
 * Provides a connection wrapper that automatically handles table prefixes
 * for project-specific queries. This allows existing queries to work unchanged
 * while using the new table-prefix architecture.
 */

import mysql from 'mysql2/promise';
// Default table names - can be extended by the consuming application
// Note: All tables now use camelCase after migration
const DEFAULT_TABLES = [
  'extractedFacts',
  'redFlags',
  'documents',
  'documentChunks',
  'factSources',
  'projects'
];

/**
 * Project-aware database connection
 * Automatically prefixes table names in queries
 */
export class ProjectDbConnection {
  private connection: mysql.Connection;
  private projectId: number;
  private tableNames: string[];

  constructor(connection: mysql.Connection, projectId: number) {
    this.connection = connection;
    this.projectId = projectId;
    this.tableNames = DEFAULT_TABLES;
  }

  /**
   * Transform query to use prefixed table names
   */
  private transformQuery(query: string): string {
    let transformed = query;
    
    // Replace each table name with prefixed version
    // Use word boundaries to avoid partial matches
    for (const tableName of this.tableNames) {
      const regex = new RegExp(`\\b${tableName}\\b`, 'gi');
      transformed = transformed.replace(regex, `proj_${this.projectId}_${tableName}`);
    }
    
    return transformed;
  }

  /**
   * Execute a query with automatic table prefix transformation
   */
  async execute(query: string, values?: any): Promise<[any, any]> {
    const transformedQuery = this.transformQuery(query);
    return await this.connection.execute(transformedQuery, values) as [any, any];
  }

  /**
   * Query with automatic table prefix transformation
   */
  async query(query: string, values?: any): Promise<any> {
    const transformedQuery = this.transformQuery(query);
    return await this.connection.query(transformedQuery, values);
  }

  /**
   * Get the underlying connection (for operations that don't need transformation)
   */
  getConnection(): mysql.Connection {
    return this.connection;
  }

  /**
   * End the connection
   */
  async end(): Promise<void> {
    await this.connection.end();
  }
}

/**
 * Project-aware database pool
 * Automatically prefixes table names in queries
 */
export class ProjectDbPool {
  private pool: mysql.Pool;
  private projectId: number;
  private tableNames: string[];

  constructor(pool: mysql.Pool, projectId: number) {
    this.pool = pool;
    this.projectId = projectId;
    this.tableNames = DEFAULT_TABLES;
  }

  /**
   * Transform query to use prefixed table names
   */
  private transformQuery(query: string): string {
    let transformed = query;
    
    for (const tableName of this.tableNames) {
      const regex = new RegExp(`\\b${tableName}\\b`, 'gi');
      transformed = transformed.replace(regex, `proj_${this.projectId}_${tableName}`);
    }
    
    return transformed;
  }

  /**
   * Execute a query with automatic table prefix transformation
   */
  async execute(query: string, values?: any): Promise<[any, any]> {
    const transformedQuery = this.transformQuery(query);
    return await this.pool.execute(transformedQuery, values) as [any, any];
  }

  /**
   * Query with automatic table prefix transformation
   */
  async query(query: string, values?: any): Promise<any> {
    const transformedQuery = this.transformQuery(query);
    return await this.pool.query(transformedQuery, values);
  }

  /**
   * Get a connection from the pool
   */
  async getConnection(): Promise<mysql.PoolConnection> {
    return await this.pool.getConnection();
  }

  /**
   * End the pool
   */
  async end(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Create a project-aware connection from a raw mysql2 connection
 */
export function wrapConnection(connection: mysql.Connection, projectId: number): ProjectDbConnection {
  return new ProjectDbConnection(connection, projectId);
}

/**
 * Create a project-aware pool from a raw mysql2 pool
 */
export function wrapPool(pool: mysql.Pool, projectId: number): ProjectDbPool {
  return new ProjectDbPool(pool, projectId);
}
