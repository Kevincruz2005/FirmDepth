// Generated from ProtectedDebtRepayment.sol.
export const debtRepaymentAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "settlement_",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "pool_",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "variableDebtToken_",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "chainId_",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "DebtBelowMinimum",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "IncompatibleReserve",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InexactTransfer",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidDebtReduction",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidRepayment",
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
        "internalType": "bytes32",
        "name": "commitmentId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "borrower",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "actualRepaid",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "debtBefore",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "debtAfter",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "scaledDebtBefore",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "scaledDebtAfter",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "usdcRefund",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "wethRefund",
        "type": "uint256"
      }
    ],
    "name": "DebtRepaid",
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
        "internalType": "bytes32",
        "name": "commitmentAuthorizationHash",
        "type": "bytes32"
      }
    ],
    "name": "RepaymentAccepted",
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
        "indexed": true,
        "internalType": "address",
        "name": "borrower",
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
        "name": "maxRepay",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "minRepay",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "authorizationHash",
        "type": "bytes32"
      }
    ],
    "name": "RepaymentCreated",
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
    "name": "RepaymentRefunded",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "DEBT_MODE",
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
    "inputs": [],
    "name": "DEBT_ROUNDING_TOLERANCE",
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
    "inputs": [],
    "name": "aToken",
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
    "inputs": [],
    "name": "addressesProvider",
    "outputs": [
      {
        "internalType": "contract IAaveRepaymentProvider",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "authorizedChainId",
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
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "borrower",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "debtMode",
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
        "internalType": "uint256",
        "name": "maxRepay",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minRepay",
        "type": "uint256"
      }
    ],
    "name": "createRepaymentPlan",
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
    "inputs": [],
    "name": "dataProvider",
    "outputs": [
      {
        "internalType": "contract IAaveRepaymentDataProvider",
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
    "name": "getRepaymentPlan",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "payer",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "borrower",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "maxRepay",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minRepay",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "authorizationHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "commitmentId",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "actualRepaid",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "debtBefore",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "debtAfter",
            "type": "uint256"
          }
        ],
        "internalType": "struct ProtectedDebtRepayment.RepaymentPlan",
        "name": "repayment",
        "type": "tuple"
      },
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
        "name": "underlying",
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
    "inputs": [],
    "name": "pool",
    "outputs": [
      {
        "internalType": "contract IAaveRepaymentPool",
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
    "name": "refundPlan",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "settlement",
    "outputs": [
      {
        "internalType": "contract ProtectedSettlement",
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
    "name": "variableDebtToken",
    "outputs": [
      {
        "internalType": "contract IAaveRepaymentDebt",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
