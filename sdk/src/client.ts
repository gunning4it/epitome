import { EpitomeHttpClient } from './http.js';
import { getUserContextMethod } from './methods/context.js';
import { queryGraphMethod } from './methods/graph.js';
import {
  getProfileMethod,
  updateProfileMethod,
} from './methods/profile.js';
import {
  addRecordMethod,
  listTablesMethod,
  queryTableMethod,
} from './methods/tables.js';
import {
  saveMemoryMethod,
  searchMemoryMethod,
} from './methods/vectors.js';
import type {
  AddRecordInput,
  AddRecordResult,
  EpitomeClientConfig,
  GetProfileResult,
  GetUserContextInput,
  GetUserContextResult,
  ListTablesResult,
  QueryGraphInput,
  QueryGraphResult,
  QueryTableInput,
  QueryTableResult,
  SaveMemoryInput,
  SaveMemoryResult,
  SearchMemoryInput,
  SearchMemoryResult,
  UpdateProfileInput,
  UpdateProfileResult,
} from './types.js';

export class EpitomeClient {
  private readonly http: EpitomeHttpClient;
  private readonly defaultCollection: string;

  constructor(config: EpitomeClientConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error('EpitomeClient requires a non-empty apiKey');
    }

    this.http = new EpitomeHttpClient(config);
    this.defaultCollection = config.defaultCollection ?? 'memories';
  }

  async saveMemory(input: SaveMemoryInput): Promise<SaveMemoryResult> {
    return saveMemoryMethod(this.http, input, this.defaultCollection);
  }

  async searchMemory(input: SearchMemoryInput): Promise<SearchMemoryResult> {
    return searchMemoryMethod(this.http, input, this.defaultCollection);
  }

  async search(input: SearchMemoryInput): Promise<SearchMemoryResult> {
    return this.searchMemory(input);
  }

  async getUserContext(input: GetUserContextInput = {}): Promise<GetUserContextResult> {
    return getUserContextMethod(this.http, input);
  }

  async getProfile(): Promise<GetProfileResult> {
    return getProfileMethod(this.http);
  }

  async updateProfile(input: UpdateProfileInput): Promise<UpdateProfileResult> {
    return updateProfileMethod(this.http, input);
  }

  async queryGraph(input: QueryGraphInput): Promise<QueryGraphResult> {
    return queryGraphMethod(this.http, input);
  }

  async queryTable(input: QueryTableInput): Promise<QueryTableResult> {
    return queryTableMethod(this.http, input);
  }

  async listTables(): Promise<ListTablesResult> {
    return listTablesMethod(this.http);
  }

  async addRecord(input: AddRecordInput): Promise<AddRecordResult> {
    return addRecordMethod(this.http, input);
  }
}
