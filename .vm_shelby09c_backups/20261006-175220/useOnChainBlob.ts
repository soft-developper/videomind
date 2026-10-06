// src/hooks/useOnChainBlob.ts
// Queries the shelbynet blob indexer for one blob's live on-chain record.
import { useQuery } from "@tanstack/react-query";
import { SHELBY_INDEXER } from "@/lib/explorer";

export interface OnChainBlob {
  object_name: string;
  uid: string | number;
  owner: string;
  placement_group: string;
  slice_address: string;
  last_transaction_version: number;
  created_at: number;
  expires_at: number;
  size: number;
  blob_commitment: string | null;
  num_chunksets: number | null;
  is_committed: string | number | null;
  is_persisted: string | number | null;
  encoding: string | number | null;
}

const QUERY = `
  query VideoMindBlob($name: String!) {
    blobs(where: { object_name: { _eq: $name }, is_deleted: { _eq: "0" } }, limit: 1) {
      object_name
      uid
      owner
      placement_group
      slice_address
      last_transaction_version
      created_at
      expires_at
      size
      blob_commitment
      num_chunksets
      is_committed
      is_persisted
      encoding
    }
  }
`;

/**
 * Blobs are stored on-chain as "@{ownerWithout0x}/{blobName}".
 */
export function toObjectName(owner: string, blobName: string): string {
  return `@${owner.replace(/^0x/, "")}/${blobName}`;
}

export function useOnChainBlob(owner?: string, blobName?: string) {
  const objectName = owner && blobName ? toObjectName(owner, blobName) : null;

  return useQuery({
    queryKey: ["onchain-blob", objectName],
    enabled: !!objectName,
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<OnChainBlob | null> => {
      const key = process.env.NEXT_PUBLIC_APTOS_API_KEY;
      const res = await fetch(SHELBY_INDEXER, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({ query: QUERY, variables: { name: objectName } }),
      });

      const json = await res.json();
      if (json.errors) throw new Error(json.errors[0]?.message ?? "Indexer error");
      return json.data?.blobs?.[0] ?? null;
    },
  });
}
