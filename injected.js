// This script is injected into the page context to intercept fetch requests
(function() {
  'use strict';

  console.log('[Getgems Marker] Injected script starting...');

  // Store NFT marketplace data
  const nftMarketplaceData = {};

  // Store headers from successful GraphQL requests
  let capturedHeaders = null;

  // Store current user ID from getCurrentUser response
  let currentUserId = null;

  // Override fetch to intercept GraphQL responses
  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    const url = args[0]?.url || args[0];
    const options = args[1] || {};

    // Get operation name for GraphQL requests
    let operationName = null;
    if (typeof url === 'string' && url.includes('getgems.io/graphql')) {
      const urlMatch = url.match(/operationName=([^&]+)/);
      if (urlMatch) {
        operationName = urlMatch[1];
      }
      if (!operationName && options.body) {
        try {
          const body = JSON.parse(options.body);
          operationName = body.operationName;
        } catch (e) {}
      }
      console.log('[Getgems Marker] GraphQL request:', operationName || 'unknown');
      
      // Capture headers from GraphQL requests for later use
      if (options.headers && !capturedHeaders) {
        capturedHeaders = {};
        if (options.headers instanceof Headers) {
          options.headers.forEach((value, key) => {
            capturedHeaders[key] = value;
          });
        } else if (typeof options.headers === 'object') {
          capturedHeaders = { ...options.headers };
        }
        console.log('[Getgems Marker] Captured GraphQL headers');
      }
    }

    const response = await originalFetch.apply(this, args);

    try {
      if (typeof url === 'string' && url.includes('getgems.io/graphql')) {
        const clonedResponse = response.clone();

        clonedResponse.json().then(data => {
          processGraphQLResponse(data, operationName);
        }).catch(() => {});
      }
    } catch (e) {}

    return response;
  };

  // Detect marketplace from a sale object using all available signals
  function detectMarketplace(sale) {
    if (!sale) return null;

    // Jetton and other non-TON fixed-price sales should always be treated as Getgems listings
    if (sale.currency && sale.currency !== 'TON') return 'getgems';

    // 1. Explicit marketplace field (auctions have this)
    if (sale.marketplace === 'GETGEMS') return 'getgems';
    if (sale.marketplace === 'FRAGMENT') return 'fragment';

    // 2. Sale __typename
    if (sale.__typename === 'NftSaleAuction') return 'getgems';
    if (sale.__typename === 'TelemintAuction') return 'fragment';

    // 3. networkFee for fixed-price listings
    if (sale.networkFee !== undefined) {
      const networkFee = parseInt(sale.networkFee || '0');
      return networkFee === 300000000 ? 'getgems' : 'fragment';
    }

    return null;
  }

  function formatTonPrice(fullPrice) {
    if (typeof fullPrice !== 'string' || !/^\d+$/.test(fullPrice)) return null;

    const nanoTonScale = 1000000000n;
    const nanoTonValue = BigInt(fullPrice);
    const wholeTon = nanoTonValue / nanoTonScale;
    const fractionalTon = (nanoTonValue % nanoTonScale).toString().padStart(9, '0');

    if (fractionalTon === '000000000') {
      return wholeTon.toString();
    }

    return `${wholeTon.toString()}.${fractionalTon.replace(/0+$/, '')}`;
  }

  function extractTonPriceData(sale) {
    if (!sale || sale.currency !== 'TON' || typeof sale.fullPrice !== 'string' || !/^\d+$/.test(sale.fullPrice)) {
      return {};
    }

    const nanoTonScale = 1000000000n;
    const nanoTonValue = BigInt(sale.fullPrice);
    const fullPriceTon = formatTonPrice(sale.fullPrice);

    if (!fullPriceTon) {
      return {};
    }

    return {
      fullPriceNano: sale.fullPrice,
      fullPriceTon: fullPriceTon,
      hasOneNanoTonTail: nanoTonValue % nanoTonScale === 1n
    };
  }

  function resolveSaleData(item, cache = null) {
    if (!item?.sale) return null;

    if (item.sale.__ref && cache?.[item.sale.__ref]) {
      return cache[item.sale.__ref];
    }

    return item.sale;
  }

  function buildNftDataEntry(item, marketplace, ownerId, sale) {
    const entry = {
      ...extractTonPriceData(sale)
    };

    if (item?.name) {
      entry.name = item.name;
    }

    if (marketplace) {
      entry.marketplace = marketplace;
    }

    if (item?.kind) {
      entry.kind = item.kind;
    }

    if (ownerId !== undefined) {
      entry.ownerId = ownerId;
    }

    return entry;
  }

  function upsertNftData(address, entry) {
    if (!address || !entry) return false;

    const isNew = !nftMarketplaceData[address];
    nftMarketplaceData[address] = {
      ...(nftMarketplaceData[address] || {}),
      ...entry
    };

    return isNew;
  }

  function postNftData() {
    if (Object.keys(nftMarketplaceData).length === 0) return;

    window.postMessage({
      type: 'GETGEMS_MARKER_NFT_DATA',
      data: nftMarketplaceData
    }, '*');
    console.log('[Getgems Marker] Sent data to content script');
  }

  // Listen for requests from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'GETGEMS_MARKER_REQUEST_DATA') {
      console.log('[Getgems Marker] Received request for', event.data.addresses.length, 'NFT addresses');
      fetchNftData(event.data.addresses);
    }

    if (event.data?.type === 'GETGEMS_MARKER_EXTRACT_PAGE_DATA') {
      console.log('[Getgems Marker] Extracting data from page...');
      extractPageData();
    }
  });

  // Extract NFT data from __NEXT_DATA__ (for item pages)
  function extractPageData() {
    try {
      const nextDataScript = document.getElementById('__NEXT_DATA__');
      if (!nextDataScript) {
        console.log('[Getgems Marker] __NEXT_DATA__ not found');
        return;
      }

      const data = JSON.parse(nextDataScript.textContent);
      const cache = data?.props?.pageProps?.gqlCache || {};
      const pageProps = data?.props?.pageProps || {};

      console.log('[Getgems Marker] Found gqlCache with', Object.keys(cache).length, 'entries');
      console.log('[Getgems Marker] gqlCache keys:', Object.keys(cache));

      let addedCount = 0;

      // Check NftItem entries in normalized Apollo cache
      for (const [key, value] of Object.entries(cache)) {
        if (!key.startsWith('NftItem:') || !value.address) continue;

        const saleData = resolveSaleData(value, cache);
        let marketplace = null;

        if (value.kind === 'OffchainNft') {
          marketplace = 'getgems';
        } else if (saleData) {
          marketplace = detectMarketplace(saleData);
        }

        if (!marketplace) continue;

        const ownerRef = value.owner?.__ref;
        const ownerData = ownerRef ? cache[ownerRef] : value.owner;
        const isNew = upsertNftData(
          value.address,
          buildNftDataEntry(value, marketplace, ownerData?.id, saleData)
        );

        if (isNew) {
          addedCount++;
          console.log('[Getgems Marker] Extracted:', value.name, '| Marketplace:', marketplace);
        }
      }

      // For /nft/ pages: look for nftItemByAddress in pageProps or dehydratedState
      if (addedCount === 0) {
        console.log('[Getgems Marker] Searching for NFT data in pageProps...');
        const nftItem = findNftItemInObject(pageProps);
        if (nftItem && nftItem.address) {
          const saleData = resolveSaleData(nftItem, cache);
          let marketplace = null;

          if (nftItem.kind === 'OffchainNft') {
            marketplace = 'getgems';
          } else if (saleData) {
            marketplace = detectMarketplace(saleData);
          }

          if (marketplace) {
            const ownerRef = nftItem.owner?.__ref;
            const ownerData = ownerRef ? cache[ownerRef] : nftItem.owner;
            const isNew = upsertNftData(
              nftItem.address,
              buildNftDataEntry(nftItem, marketplace, ownerData?.id, saleData)
            );
            if (isNew) {
              addedCount++;
            }
            console.log('[Getgems Marker] Extracted from pageProps:', nftItem.name, '| Marketplace:', marketplace);
          } else {
            console.log('[Getgems Marker] Found NFT but could not determine marketplace:', nftItem.name, nftItem);
          }
        }
      }

      // Also search in dehydratedState (React Query cache)
      if (addedCount === 0 && pageProps.dehydratedState?.queries) {
        console.log('[Getgems Marker] Searching in dehydratedState...');
        for (const query of pageProps.dehydratedState.queries) {
          const nftItem = findNftItemInObject(query.state?.data);
          if (nftItem && nftItem.address && nftItem.sale) {
            const saleData = resolveSaleData(nftItem, cache);
            let marketplace = null;

            if (nftItem.kind === 'OffchainNft') {
              marketplace = 'getgems';
            } else {
              marketplace = detectMarketplace(saleData);
            }

            if (marketplace) {
              const isNew = upsertNftData(
                nftItem.address,
                buildNftDataEntry(nftItem, marketplace, nftItem.owner?.id, saleData)
              );
              if (isNew) {
                addedCount++;
              }
              console.log('[Getgems Marker] Extracted from dehydratedState:', nftItem.name, '| Marketplace:', marketplace);
            }
          }
        }
      }

      console.log('[Getgems Marker] Extracted', addedCount, 'NFTs from page data. Total:', Object.keys(nftMarketplaceData).length);

      postNftData();

    } catch (e) {
      console.error('[Getgems Marker] Error extracting page data:', e);
    }
  }

  // Helper function to find NFT item data in an object (recursive search)
  function findNftItemInObject(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;
    
    // Check if this object looks like an NFT item
    if (obj.address && obj.__typename === 'NftItem') {
      return obj;
    }
    
    // Check common property names for NFT data
    if (obj.nftItemByAddress) return obj.nftItemByAddress;
    if (obj.nftItem) return obj.nftItem;
    if (obj.item && obj.item.address) return obj.item;
    
    // Recursively search
    for (const key of Object.keys(obj)) {
      const result = findNftItemInObject(obj[key], depth + 1);
      if (result) return result;
    }
    
    return null;
  }

  // Fetch NFT data for specific addresses
  async function fetchNftData(addresses) {
    if (!addresses || addresses.length === 0) return;

    // Check if we're on a collection page, NFT page, or user page
    const collectionMatch = window.location.pathname.match(/\/collection\/([A-Za-z0-9_-]+)/);
    const nftMatch = window.location.pathname.match(/\/nft\/([A-Za-z0-9_-]+)/);
    const userMatch = window.location.pathname.match(/\/user\/([A-Za-z0-9_-]+)/);

    if (nftMatch) {
      // On /nft/ADDRESS page, fetch data for this specific NFT
      const nftAddress = nftMatch[1];
      console.log('[Getgems Marker] Fetching data for single NFT:', nftAddress);
      await fetchSingleNftData(nftAddress);
      return;
    }

    if (userMatch) {
      // On /user/ADDRESS page, fetch data for individual NFTs by address
      console.log('[Getgems Marker] Fetching data for', addresses.length, 'NFTs on user page');
      for (const addr of addresses) {
        if (!nftMarketplaceData[addr] || !nftMarketplaceData[addr].fullPriceNano) {
          await fetchSingleNftData(addr);
        }
      }
      return;
    }

    if (!collectionMatch) {
      console.log('[Getgems Marker] Could not determine collection, NFT, or user address');
      return;
    }
    const collectionAddress = collectionMatch[1];

    console.log('[Getgems Marker] Fetching data for collection:', collectionAddress);

    try {
      const query = `
        query nftSearch($query: String!, $count: Int!, $cursor: String) {
          alphaNftItemSearch(query: $query, first: $count, after: $cursor) {
            edges {
              node {
                __typename
                address
                name
                kind
                owner {
                  id
                }
                sale {
                  __typename
                  ... on NftSaleFixPrice {
                    address
                    fullPrice
                    networkFee
                    currency
                  }
                  ... on NftSaleAuction {
                    address
                    networkFee
                    marketplace
                  }
                  ... on TelemintAuction {
                    marketplace
                  }
                }
              }
            }
          }
        }
      `;

      const variables = {
        query: JSON.stringify({
          "$and": [
            {"collectionAddress": collectionAddress},
            {"saleType": "fix_price"}
          ]
        }),
        count: 100,
        cursor: null
      };

      const response = await originalFetch('https://getgems.io/graphql/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operationName: 'nftSearch',
          query: query,
          variables: variables
        })
      });

      const data = await response.json();
      processGraphQLResponse(data, 'nftSearch (manual)');

    } catch (e) {
      console.error('[Getgems Marker] Error fetching NFT data:', e);
    }
  }

  // Fetch data for a single NFT by address (for /nft/ADDRESS pages)
  async function fetchSingleNftData(nftAddress) {
    try {
      const query = `
        query alphaNftItemByAddress($address: String!) {
          alphaNftItemByAddress(address: $address) {
            __typename
            address
            name
            kind
            owner {
              id
            }
            sale {
              __typename
              ... on NftSaleFixPrice {
                address
                fullPrice
                networkFee
                currency
              }
              ... on NftSaleAuction {
                address
                networkFee
                marketplace
              }
              ... on TelemintAuction {
                marketplace
              }
            }
          }
        }
      `;

      const variables = {
        address: nftAddress
      };

      // Use captured headers if available, otherwise use minimal headers
      const headers = capturedHeaders ? {
        ...capturedHeaders,
        'Content-Type': 'application/json',
      } : {
        'Content-Type': 'application/json',
      };

      const response = await originalFetch('https://getgems.io/graphql/', {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify({
          operationName: 'alphaNftItemByAddress',
          query: query,
          variables: variables
        })
      });

      const data = await response.json();
      
      if (data?.data?.alphaNftItemByAddress) {
        const item = data.data.alphaNftItemByAddress;
        let marketplace = null;

        if (item.kind === 'OffchainNft') {
          marketplace = 'getgems';
        } else if (item.sale) {
          marketplace = detectMarketplace(item.sale);
        }

        if (marketplace) {
          upsertNftData(
            item.address,
            buildNftDataEntry(item, marketplace, item.owner?.id, resolveSaleData(item))
          );
          console.log('[Getgems Marker] Fetched single NFT:', item.name, '| Marketplace:', marketplace);

          postNftData();
        }
      }

    } catch (e) {
      console.error('[Getgems Marker] Error fetching single NFT data:', e);
    }
  }

  function processGraphQLResponse(data, operationName) {
    try {
      // Capture current user ID from getCurrentUser response
      if (operationName === 'getCurrentUser' && data?.data?.me?.id) {
        currentUserId = data.data.me.id;
        console.log('[Getgems Marker] Captured current user ID:', currentUserId);
        window.postMessage({
          type: 'GETGEMS_MARKER_CURRENT_USER',
          userId: currentUserId
        }, '*');
        return;
      }

      const items = findNftItems(data);

      if (items.length === 0) return;

      console.log('[Getgems Marker] Found', items.length, 'NFT items in', operationName);

      let addedCount = 0;

      items.forEach(item => {
        if (item.address) {
          const saleData = resolveSaleData(item);
          let marketplace = null;

          if (item.kind === 'OffchainNft') {
            marketplace = 'getgems';
          } else if (saleData) {
            marketplace = detectMarketplace(saleData);
          }

          if (marketplace) {
            const isNew = upsertNftData(
              item.address,
              buildNftDataEntry(item, marketplace, item.owner?.id, saleData)
            );
            if (isNew) {
              addedCount++;
            }
          }
        }
      });

      console.log('[Getgems Marker] Added', addedCount, 'new NFTs. Total:', Object.keys(nftMarketplaceData).length);

      if (addedCount > 0 || Object.keys(nftMarketplaceData).length > 0) {
        postNftData();
      }

    } catch (e) {
      console.error('[Getgems Marker] Error:', e);
    }
  }

  function findNftItems(obj, items = [], seen = new Set(), depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 15) return items;

    if (obj.edges && Array.isArray(obj.edges)) {
      obj.edges.forEach(edge => {
        if (edge.node && edge.node.address && !seen.has(edge.node.address)) {
          seen.add(edge.node.address);
          items.push(edge.node);
        }
      });
    }

    for (const key in obj) {
      if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
        findNftItems(obj[key], items, seen, depth + 1);
      }
    }

    return items;
  }

  console.log('[Getgems Marker] Fetch interceptor installed');
})();
