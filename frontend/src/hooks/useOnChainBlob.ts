// src/hooks/useOnChainBlob.ts
// Reads one video's live on-chain record: the Shelbynet object index
// plus the Shelby contract views. All parsing lives in @/lib/onchain.
import { useQuery } from "@tanstack/react-query";
import { fetchOnChainBlob, toObjectName, type OnChainBlob } from "@/lib/onchain";

export { toObjectName };
export type { OnChainBlob };

export function useOnChainBlob(owner?: string, blobName?: string) {
  const objectName = owner && blobName ? toObjectName(owner, blobName) : null;

  return useQuery({
    queryKey: ["onchain-blob", objectName],
    enabled: !!objectName,
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<OnChainBlob | null> =>
      fetchOnChainBlob(objectName as string, process.env.NEXT_PUBLIC_APTOS_API_KEY),
  });
}
