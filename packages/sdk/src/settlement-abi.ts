// Generated from ProtectedSettlement.sol; regenerate when its interface changes.
export const settlementAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "registry_",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "executor_",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "InexactTransfer",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPlan",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidQuote",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidState",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "SafeERC20FailedOperation",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Unauthorized",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "planId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Allocation",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "planId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "commitmentId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "premium",
        "type": "uint256"
      }
    ],
    "name": "PlanAccepted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "planId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "payer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amountIn",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxPremium",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "deadline",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalOut",
        "type": "uint256"
      }
    ],
    "name": "PlanCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "planId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "PlanFunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "planId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "payer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "PlanRefunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "planId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "commitmentId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "enum CommitmentStatus",
        "name": "status",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "proceeds",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "surplus",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "refund",
        "type": "uint256"
      }
    ],
    "name": "PlanSettled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "planId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "RecipientPaid",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "MAX_RECIPIENTS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "maker",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "taker",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "executor",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "swapRouter",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "tokenIn",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "tokenOut",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "referenceAmountOut",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minAmountOut",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "requiredBond",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "premiumToken",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "premiumAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint32",
            "name": "pricingVersion",
            "type": "uint32"
          },
          {
            "internalType": "uint256",
            "name": "sigmaWad",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "annualCapitalRateWad",
            "type": "uint256"
          },
          {
            "internalType": "uint16",
            "name": "capacityKBps",
            "type": "uint16"
          },
          {
            "internalType": "uint256",
            "name": "utilizationAfterWad",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minPremiumOut",
            "type": "uint256"
          },
          {
            "internalType": "uint32",
            "name": "pricingTtl",
            "type": "uint32"
          },
          {
            "internalType": "uint64",
            "name": "expiry",
            "type": "uint64"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "internalType": "struct FirmQuote",
        "name": "quote",
        "type": "tuple"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "maker",
            "type": "address"
          },
          {
            "internalType": "MakerTraits",
            "name": "traits",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          }
        ],
        "internalType": "struct ISwapVM.Order",
        "name": "order",
        "type": "tuple"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "acceptPlan",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "commitmentId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "commitmentPlan",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amountIn",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxPremium",
        "type": "uint256"
      },
      {
        "internalType": "uint64",
        "name": "deadline",
        "type": "uint64"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "internalType": "struct ProtectedSettlement.Payout[]",
        "name": "payouts",
        "type": "tuple[]"
      }
    ],
    "name": "createPlan",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "maker",
            "type": "address"
          },
          {
            "internalType": "MakerTraits",
            "name": "traits",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          }
        ],
        "internalType": "struct ISwapVM.Order",
        "name": "order",
        "type": "tuple"
      }
    ],
    "name": "executePlan",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "executor",
    "outputs": [
      {
        "internalType": "contract FirmExecutor",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "fundPlan",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "getPayouts",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "internalType": "struct ProtectedSettlement.Payout[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "getPlan",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "payer",
            "type": "address"
          },
          {
            "internalType": "enum ProtectedSettlement.State",
            "name": "state",
            "type": "uint8"
          },
          {
            "internalType": "uint64",
            "name": "deadline",
            "type": "uint64"
          },
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxPremium",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "totalOut",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "escrow",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "premiumPaid",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "commitmentId",
            "type": "bytes32"
          }
        ],
        "internalType": "struct ProtectedSettlement.Plan",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "payer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      }
    ],
    "name": "planIdFor",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "refundPlan",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "registry",
    "outputs": [
      {
        "internalType": "contract FirmCommitmentRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "router",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "tokenIn",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "tokenOut",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalEscrow",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
