export interface AzureDevopsProject {
  id: string;
  name: string;
  description?: string;
  state: string;
  url: string;
}

export interface AzureDevopsRepository {
  id: string;
  name: string;
  url: string;
  remoteUrl: string;
  webUrl: string;
  defaultBranch?: string;
  size?: number;
  project: {
    id: string;
    name: string;
  };
}

export interface AzureDevopsRef {
  name: string;
  objectId: string;
}

export interface AzureDevopsCommit {
  commitId: string;
  comment?: string;
  url?: string;
  remoteUrl?: string;
  author?: {
    name?: string;
    email?: string;
    date?: string;
  };
}

export interface AzureDevopsItem {
  objectId?: string;
  gitObjectType?: string;
  path: string;
  isFolder?: boolean;
  content?: string;
  url?: string;
}
