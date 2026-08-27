export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_intake_proposals: {
        Row: {
          addressedTo: string | null
          created_at: string
          documentDate: string | null
          emailMessageId: string | null
          id: string
          kind: string
          matchedLoanId: string | null
          matchedTenantId: string | null
          payload: Json
          propertyId: string | null
          providerName: string | null
          rawPropertyAddress: string | null
          reviewReason: string | null
          sourceEmailBody: string | null
          sourceFileData: string | null
          sourceFileName: string | null
          sourceSubject: string | null
          status: string
        }
        Insert: {
          addressedTo?: string | null
          created_at?: string
          documentDate?: string | null
          emailMessageId?: string | null
          id: string
          kind: string
          matchedLoanId?: string | null
          matchedTenantId?: string | null
          payload: Json
          propertyId?: string | null
          providerName?: string | null
          rawPropertyAddress?: string | null
          reviewReason?: string | null
          sourceEmailBody?: string | null
          sourceFileData?: string | null
          sourceFileName?: string | null
          sourceSubject?: string | null
          status?: string
        }
        Update: {
          addressedTo?: string | null
          created_at?: string
          documentDate?: string | null
          emailMessageId?: string | null
          id?: string
          kind?: string
          matchedLoanId?: string | null
          matchedTenantId?: string | null
          payload?: Json
          propertyId?: string | null
          providerName?: string | null
          rawPropertyAddress?: string | null
          reviewReason?: string | null
          sourceEmailBody?: string | null
          sourceFileData?: string | null
          sourceFileName?: string | null
          sourceSubject?: string | null
          status?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          aiConfig: Json
          id: string
          landlordProfile: Json
          leaseTemplate: Json | null
          reportHistory: Json | null
          tenantInfoStatement: Json | null
          updated_at: string
        }
        Insert: {
          aiConfig?: Json
          id: string
          landlordProfile?: Json
          leaseTemplate?: Json | null
          reportHistory?: Json | null
          tenantInfoStatement?: Json | null
          updated_at?: string
        }
        Update: {
          aiConfig?: Json
          id?: string
          landlordProfile?: Json
          leaseTemplate?: Json | null
          reportHistory?: Json | null
          tenantInfoStatement?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          assetType: string
          created_at: string
          currentValue: number
          id: string
          linkedPropertyId: string | null
          name: string
          notes: string | null
          ownerEntityId: string | null
          purchaseCost: number | null
          purchaseDate: string | null
          status: string
          tags: string[] | null
          updated_at: string
          valuationDate: string | null
        }
        Insert: {
          assetType: string
          created_at?: string
          currentValue?: number
          id: string
          linkedPropertyId?: string | null
          name: string
          notes?: string | null
          ownerEntityId?: string | null
          purchaseCost?: number | null
          purchaseDate?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string
          valuationDate?: string | null
        }
        Update: {
          assetType?: string
          created_at?: string
          currentValue?: number
          id?: string
          linkedPropertyId?: string | null
          name?: string
          notes?: string | null
          ownerEntityId?: string | null
          purchaseCost?: number | null
          purchaseDate?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string
          valuationDate?: string | null
        }
        Relationships: []
      }
      buffers: {
        Row: {
          created_at: string
          currentBalance: number
          id: string
          label: string
          scopeId: string | null
          scopeType: string
          targetAmount: number | null
          targetMonths: number | null
        }
        Insert: {
          created_at?: string
          currentBalance?: number
          id: string
          label?: string
          scopeId?: string | null
          scopeType?: string
          targetAmount?: number | null
          targetMonths?: number | null
        }
        Update: {
          created_at?: string
          currentBalance?: number
          id?: string
          label?: string
          scopeId?: string | null
          scopeType?: string
          targetAmount?: number | null
          targetMonths?: number | null
        }
        Relationships: []
      }
      depreciation_items: {
        Row: {
          assetId: string
          created_at: string
          description: string
          division: string | null
          effectiveFrom: string | null
          effectiveLifeYears: number
          id: string
          method: string | null
          purchaseCost: number
          purchaseDate: string | null
          quantitySurveyor: string | null
          reportDate: string | null
          reportId: string | null
          reportReference: string | null
          sourceFileData: string | null
          sourceFileName: string | null
        }
        Insert: {
          assetId: string
          created_at?: string
          description: string
          division?: string | null
          effectiveFrom?: string | null
          effectiveLifeYears?: number
          id: string
          method?: string | null
          purchaseCost?: number
          purchaseDate?: string | null
          quantitySurveyor?: string | null
          reportDate?: string | null
          reportId?: string | null
          reportReference?: string | null
          sourceFileData?: string | null
          sourceFileName?: string | null
        }
        Update: {
          assetId?: string
          created_at?: string
          description?: string
          division?: string | null
          effectiveFrom?: string | null
          effectiveLifeYears?: number
          id?: string
          method?: string | null
          purchaseCost?: number
          purchaseDate?: string | null
          quantitySurveyor?: string | null
          reportDate?: string | null
          reportId?: string | null
          reportReference?: string | null
          sourceFileData?: string | null
          sourceFileName?: string | null
        }
        Relationships: []
      }
      email_inbox_log: {
        Row: {
          attachmentFileName: string | null
          billId: string | null
          created_at: string
          documentType: string | null
          emailId: string | null
          errorMessage: string | null
          fromAddress: string | null
          hasAttachment: boolean
          id: string
          proposalId: string | null
          status: string
          subject: string | null
        }
        Insert: {
          attachmentFileName?: string | null
          billId?: string | null
          created_at?: string
          documentType?: string | null
          emailId?: string | null
          errorMessage?: string | null
          fromAddress?: string | null
          hasAttachment?: boolean
          id: string
          proposalId?: string | null
          status: string
          subject?: string | null
        }
        Update: {
          attachmentFileName?: string | null
          billId?: string | null
          created_at?: string
          documentType?: string | null
          emailId?: string | null
          errorMessage?: string | null
          fromAddress?: string | null
          hasAttachment?: boolean
          id?: string
          proposalId?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      entities: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          owners: Json
          type: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
          notes?: string | null
          owners?: Json
          type?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          owners?: Json
          type?: string
        }
        Relationships: []
      }
      etf_details: {
        Row: {
          assetId: string
          avgCostPerUnit: number | null
          created_at: string
          exchange: string | null
          ticker: string | null
          unitsHeld: number | null
        }
        Insert: {
          assetId: string
          avgCostPerUnit?: number | null
          created_at?: string
          exchange?: string | null
          ticker?: string | null
          unitsHeld?: number | null
        }
        Update: {
          assetId?: string
          avgCostPerUnit?: number | null
          created_at?: string
          exchange?: string | null
          ticker?: string | null
          unitsHeld?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "etf_details_assetId_fkey"
            columns: ["assetId"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          assetId: string | null
          bpayBillerCode: string | null
          bpayReference: string | null
          category: string | null
          cost: number
          created_at: string
          date: string
          direction: string | null
          emailMessageId: string | null
          hasWarranty: boolean
          id: string
          invoiceFileData: string | null
          invoiceFileName: string | null
          itemName: string
          notes: string | null
          paidDate: string | null
          periodEnd: string | null
          periodStart: string | null
          propertyId: string | null
          rawPropertyAddress: string | null
          recharged: boolean
          rechargeToTenant: boolean
          referenceNumber: string | null
          reviewReason: string | null
          source: string
          sourceEmailBody: string | null
          sourceSubject: string | null
          status: string
          taxCategory: string
          tenantId: string | null
          warrantyExpiry: string | null
        }
        Insert: {
          assetId?: string | null
          bpayBillerCode?: string | null
          bpayReference?: string | null
          category?: string | null
          cost?: number
          created_at?: string
          date?: string
          direction?: string | null
          emailMessageId?: string | null
          hasWarranty?: boolean
          id: string
          invoiceFileData?: string | null
          invoiceFileName?: string | null
          itemName?: string
          notes?: string | null
          paidDate?: string | null
          periodEnd?: string | null
          periodStart?: string | null
          propertyId?: string | null
          rawPropertyAddress?: string | null
          recharged?: boolean
          rechargeToTenant?: boolean
          referenceNumber?: string | null
          reviewReason?: string | null
          source?: string
          sourceEmailBody?: string | null
          sourceSubject?: string | null
          status?: string
          taxCategory?: string
          tenantId?: string | null
          warrantyExpiry?: string | null
        }
        Update: {
          assetId?: string | null
          bpayBillerCode?: string | null
          bpayReference?: string | null
          category?: string | null
          cost?: number
          created_at?: string
          date?: string
          direction?: string | null
          emailMessageId?: string | null
          hasWarranty?: boolean
          id?: string
          invoiceFileData?: string | null
          invoiceFileName?: string | null
          itemName?: string
          notes?: string | null
          paidDate?: string | null
          periodEnd?: string | null
          periodStart?: string | null
          propertyId?: string | null
          rawPropertyAddress?: string | null
          recharged?: boolean
          rechargeToTenant?: boolean
          referenceNumber?: string | null
          reviewReason?: string | null
          source?: string
          sourceEmailBody?: string | null
          sourceSubject?: string | null
          status?: string
          taxCategory?: string
          tenantId?: string | null
          warrantyExpiry?: string | null
        }
        Relationships: []
      }
      gold_details: {
        Row: {
          assetId: string
          created_at: string
          form: string | null
          gramsHeld: number | null
          storageLocation: string | null
        }
        Insert: {
          assetId: string
          created_at?: string
          form?: string | null
          gramsHeld?: number | null
          storageLocation?: string | null
        }
        Update: {
          assetId?: string
          created_at?: string
          form?: string | null
          gramsHeld?: number | null
          storageLocation?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gold_details_assetId_fkey"
            columns: ["assetId"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          checklist: Json | null
          created_at: string
          date: string
          fileData: string | null
          fileFileName: string | null
          id: string
          issues: Json | null
          notes: string | null
          photos: Json | null
          propertyId: string
          rooms: Json | null
          signature: string | null
          status: string
          tenantId: string | null
          type: string
        }
        Insert: {
          checklist?: Json | null
          created_at?: string
          date?: string
          fileData?: string | null
          fileFileName?: string | null
          id: string
          issues?: Json | null
          notes?: string | null
          photos?: Json | null
          propertyId: string
          rooms?: Json | null
          signature?: string | null
          status?: string
          tenantId?: string | null
          type?: string
        }
        Update: {
          checklist?: Json | null
          created_at?: string
          date?: string
          fileData?: string | null
          fileFileName?: string | null
          id?: string
          issues?: Json | null
          notes?: string | null
          photos?: Json | null
          propertyId?: string
          rooms?: Json | null
          signature?: string | null
          status?: string
          tenantId?: string | null
          type?: string
        }
        Relationships: []
      }
      lease_history: {
        Row: {
          created_at: string
          id: string
          leaseDocumentFileData: string | null
          leaseDocumentFileName: string | null
          originalStartDate: string
          pastEndDate: string
          pastFrequency: string
          pastRent: number
          pastStartDate: string
          tenantId: string
        }
        Insert: {
          created_at?: string
          id: string
          leaseDocumentFileData?: string | null
          leaseDocumentFileName?: string | null
          originalStartDate?: string
          pastEndDate?: string
          pastFrequency?: string
          pastRent?: number
          pastStartDate?: string
          tenantId: string
        }
        Update: {
          created_at?: string
          id?: string
          leaseDocumentFileData?: string | null
          leaseDocumentFileName?: string | null
          originalStartDate?: string
          pastEndDate?: string
          pastFrequency?: string
          pastRent?: number
          pastStartDate?: string
          tenantId?: string
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          created_at: string
          credit: number
          date: string
          daysShift: number | null
          debit: number
          description: string
          id: string
          linkedInvoiceId: string | null
          manual: boolean | null
          newPaidUpToDate: string | null
          source: string | null
          tenantId: string
          type: string
        }
        Insert: {
          created_at?: string
          credit?: number
          date?: string
          daysShift?: number | null
          debit?: number
          description?: string
          id: string
          linkedInvoiceId?: string | null
          manual?: boolean | null
          newPaidUpToDate?: string | null
          source?: string | null
          tenantId: string
          type?: string
        }
        Update: {
          created_at?: string
          credit?: number
          date?: string
          daysShift?: number | null
          debit?: number
          description?: string
          id?: string
          linkedInvoiceId?: string | null
          manual?: boolean | null
          newPaidUpToDate?: string | null
          source?: string | null
          tenantId?: string
          type?: string
        }
        Relationships: []
      }
      loan_balance_snapshots: {
        Row: {
          balance: number
          created_at: string
          date: string
          id: string
          loanId: string
        }
        Insert: {
          balance: number
          created_at?: string
          date: string
          id: string
          loanId: string
        }
        Update: {
          balance?: number
          created_at?: string
          date?: string
          id?: string
          loanId?: string
        }
        Relationships: []
      }
      loans: {
        Row: {
          assetId: string | null
          bankName: string
          created_at: string
          dueDayOfMonth: number | null
          id: string
          interestRate: number
          isDirectDebit: boolean | null
          linkedBankAccount: string | null
          monthlyEmi: number
          offsetBalance: number | null
          propertyId: string
          status: string | null
          totalBalance: number
        }
        Insert: {
          assetId?: string | null
          bankName?: string
          created_at?: string
          dueDayOfMonth?: number | null
          id: string
          interestRate?: number
          isDirectDebit?: boolean | null
          linkedBankAccount?: string | null
          monthlyEmi?: number
          offsetBalance?: number | null
          propertyId: string
          status?: string | null
          totalBalance?: number
        }
        Update: {
          assetId?: string | null
          bankName?: string
          created_at?: string
          dueDayOfMonth?: number | null
          id?: string
          interestRate?: number
          isDirectDebit?: boolean | null
          linkedBankAccount?: string | null
          monthlyEmi?: number
          offsetBalance?: number | null
          propertyId?: string
          status?: string | null
          totalBalance?: number
        }
        Relationships: []
      }
      maintenance_requests: {
        Row: {
          category: string
          contactEmail: string
          contactName: string
          contactPhone: string
          created_at: string
          createdAt: string
          description: string
          id: string
          photos: Json
          propertyAddressTyped: string
          propertyId: string | null
          source: string | null
          status: string
          urgency: string
          video: Json | null
        }
        Insert: {
          category?: string
          contactEmail?: string
          contactName?: string
          contactPhone?: string
          created_at?: string
          createdAt?: string
          description?: string
          id: string
          photos?: Json
          propertyAddressTyped?: string
          propertyId?: string | null
          source?: string | null
          status?: string
          urgency?: string
          video?: Json | null
        }
        Update: {
          category?: string
          contactEmail?: string
          contactName?: string
          contactPhone?: string
          created_at?: string
          createdAt?: string
          description?: string
          id?: string
          photos?: Json
          propertyAddressTyped?: string
          propertyId?: string | null
          source?: string | null
          status?: string
          urgency?: string
          video?: Json | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string
          alias: string | null
          assetId: string | null
          bathrooms: number | null
          bedrooms: number | null
          carSpaces: number | null
          councilRateRef: string | null
          councilRatesAnnual: number | null
          created_at: string
          currentValue: number
          deposit: number | null
          domainPropertyType: string | null
          dwellingConfiguration: string | null
          electricalRepairsContactName: string | null
          electricalRepairsContactPhone: string | null
          electricalSafetyCertExpiry: string | null
          electricityEmbeddedNetwork: boolean | null
          entityId: string | null
          gasEmbeddedNetwork: boolean | null
          gasSafetyCertExpiry: string | null
          hasSwimmingPool: boolean | null
          id: string
          inspectionFrequencyMonths: number | null
          insuranceAnnual: number | null
          insurancePolicyNumber: string | null
          insurancePremium: number | null
          insuranceRenewalDate: string | null
          insuranceSumInsured: number | null
          insurerName: string | null
          interestRate: number | null
          landSizeSqm: number | null
          landTaxAnnual: number | null
          lender: string | null
          loanAccountRef: string | null
          loanBalance: number | null
          lotSize: string | null
          managerEmail: string | null
          managerName: string | null
          managerPhone: string | null
          maxOccupants: number | null
          notes: string | null
          occupancyType: string | null
          otherRepairsContactName: string | null
          otherRepairsContactPhone: string | null
          photos: Json | null
          physicalAttributes: string | null
          plumbingRepairsContactName: string | null
          plumbingRepairsContactPhone: string | null
          pmFeePercent: number | null
          poolSafetyCertExpiry: string | null
          premisesInclusions: string | null
          purchaseDate: string | null
          purchasePrice: number
          repairsMaintenanceAnnual: number | null
          repaymentFrequency: string | null
          saleDate: string | null
          salePrice: number | null
          sellingCosts: number | null
          smokeAlarmBackupBatteryReplaceable: boolean | null
          smokeAlarmBackupBatteryType: string | null
          smokeAlarmBatteryReplaceable: boolean | null
          smokeAlarmBatteryType: string | null
          smokeAlarmCheckDueDate: string | null
          smokeAlarmType: string | null
          stampDuty: number | null
          strataBylawsApply: boolean | null
          strataFeesAnnual: number | null
          strataLevyAmount: number | null
          strataLevyFrequency: string | null
          strataResponsibleForSmokeAlarms: boolean | null
          tenantCode: string | null
          units: Json | null
          videos: Json | null
          waterAccountRef: string | null
          waterRatesAnnual: number | null
          waterUsagePaidSeparately: boolean | null
        }
        Insert: {
          address?: string
          alias?: string | null
          assetId?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          carSpaces?: number | null
          councilRateRef?: string | null
          councilRatesAnnual?: number | null
          created_at?: string
          currentValue?: number
          deposit?: number | null
          domainPropertyType?: string | null
          dwellingConfiguration?: string | null
          electricalRepairsContactName?: string | null
          electricalRepairsContactPhone?: string | null
          electricalSafetyCertExpiry?: string | null
          electricityEmbeddedNetwork?: boolean | null
          entityId?: string | null
          gasEmbeddedNetwork?: boolean | null
          gasSafetyCertExpiry?: string | null
          hasSwimmingPool?: boolean | null
          id: string
          inspectionFrequencyMonths?: number | null
          insuranceAnnual?: number | null
          insurancePolicyNumber?: string | null
          insurancePremium?: number | null
          insuranceRenewalDate?: string | null
          insuranceSumInsured?: number | null
          insurerName?: string | null
          interestRate?: number | null
          landSizeSqm?: number | null
          landTaxAnnual?: number | null
          lender?: string | null
          loanAccountRef?: string | null
          loanBalance?: number | null
          lotSize?: string | null
          managerEmail?: string | null
          managerName?: string | null
          managerPhone?: string | null
          maxOccupants?: number | null
          notes?: string | null
          occupancyType?: string | null
          otherRepairsContactName?: string | null
          otherRepairsContactPhone?: string | null
          photos?: Json | null
          physicalAttributes?: string | null
          plumbingRepairsContactName?: string | null
          plumbingRepairsContactPhone?: string | null
          pmFeePercent?: number | null
          poolSafetyCertExpiry?: string | null
          premisesInclusions?: string | null
          purchaseDate?: string | null
          purchasePrice?: number
          repairsMaintenanceAnnual?: number | null
          repaymentFrequency?: string | null
          saleDate?: string | null
          salePrice?: number | null
          sellingCosts?: number | null
          smokeAlarmBackupBatteryReplaceable?: boolean | null
          smokeAlarmBackupBatteryType?: string | null
          smokeAlarmBatteryReplaceable?: boolean | null
          smokeAlarmBatteryType?: string | null
          smokeAlarmCheckDueDate?: string | null
          smokeAlarmType?: string | null
          stampDuty?: number | null
          strataBylawsApply?: boolean | null
          strataFeesAnnual?: number | null
          strataLevyAmount?: number | null
          strataLevyFrequency?: string | null
          strataResponsibleForSmokeAlarms?: boolean | null
          tenantCode?: string | null
          units?: Json | null
          videos?: Json | null
          waterAccountRef?: string | null
          waterRatesAnnual?: number | null
          waterUsagePaidSeparately?: boolean | null
        }
        Update: {
          address?: string
          alias?: string | null
          assetId?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          carSpaces?: number | null
          councilRateRef?: string | null
          councilRatesAnnual?: number | null
          created_at?: string
          currentValue?: number
          deposit?: number | null
          domainPropertyType?: string | null
          dwellingConfiguration?: string | null
          electricalRepairsContactName?: string | null
          electricalRepairsContactPhone?: string | null
          electricalSafetyCertExpiry?: string | null
          electricityEmbeddedNetwork?: boolean | null
          entityId?: string | null
          gasEmbeddedNetwork?: boolean | null
          gasSafetyCertExpiry?: string | null
          hasSwimmingPool?: boolean | null
          id?: string
          inspectionFrequencyMonths?: number | null
          insuranceAnnual?: number | null
          insurancePolicyNumber?: string | null
          insurancePremium?: number | null
          insuranceRenewalDate?: string | null
          insuranceSumInsured?: number | null
          insurerName?: string | null
          interestRate?: number | null
          landSizeSqm?: number | null
          landTaxAnnual?: number | null
          lender?: string | null
          loanAccountRef?: string | null
          loanBalance?: number | null
          lotSize?: string | null
          managerEmail?: string | null
          managerName?: string | null
          managerPhone?: string | null
          maxOccupants?: number | null
          notes?: string | null
          occupancyType?: string | null
          otherRepairsContactName?: string | null
          otherRepairsContactPhone?: string | null
          photos?: Json | null
          physicalAttributes?: string | null
          plumbingRepairsContactName?: string | null
          plumbingRepairsContactPhone?: string | null
          pmFeePercent?: number | null
          poolSafetyCertExpiry?: string | null
          premisesInclusions?: string | null
          purchaseDate?: string | null
          purchasePrice?: number
          repairsMaintenanceAnnual?: number | null
          repaymentFrequency?: string | null
          saleDate?: string | null
          salePrice?: number | null
          sellingCosts?: number | null
          smokeAlarmBackupBatteryReplaceable?: boolean | null
          smokeAlarmBackupBatteryType?: string | null
          smokeAlarmBatteryReplaceable?: boolean | null
          smokeAlarmBatteryType?: string | null
          smokeAlarmCheckDueDate?: string | null
          smokeAlarmType?: string | null
          stampDuty?: number | null
          strataBylawsApply?: boolean | null
          strataFeesAnnual?: number | null
          strataLevyAmount?: number | null
          strataLevyFrequency?: string | null
          strataResponsibleForSmokeAlarms?: boolean | null
          tenantCode?: string | null
          units?: Json | null
          videos?: Json | null
          waterAccountRef?: string | null
          waterRatesAnnual?: number | null
          waterUsagePaidSeparately?: boolean | null
        }
        Relationships: []
      }
      property_bills: {
        Row: {
          amount: number
          assetId: string | null
          billGroupId: string | null
          billType: string
          bpayBillerCode: string | null
          bpayReference: string | null
          category: string | null
          created_at: string
          dueDate: string
          emailMessageId: string | null
          id: string
          issueDate: string | null
          label: string | null
          lineItems: Json | null
          linkedExpenseId: string | null
          notes: string | null
          paidDate: string | null
          passwordNote: string | null
          periodEnd: string | null
          periodStart: string | null
          portalUrl: string | null
          portalUsername: string | null
          propertyId: string | null
          providerName: string | null
          recurrenceMonths: number | null
          referenceNumber: string | null
          source: string | null
          sourceFileData: string | null
          sourceFileName: string | null
          status: string
          taxCategory: string | null
          tenantRebillStatus: string | null
        }
        Insert: {
          amount?: number
          assetId?: string | null
          billGroupId?: string | null
          billType?: string
          bpayBillerCode?: string | null
          bpayReference?: string | null
          category?: string | null
          created_at?: string
          dueDate?: string
          emailMessageId?: string | null
          id: string
          issueDate?: string | null
          label?: string | null
          lineItems?: Json | null
          linkedExpenseId?: string | null
          notes?: string | null
          paidDate?: string | null
          passwordNote?: string | null
          periodEnd?: string | null
          periodStart?: string | null
          portalUrl?: string | null
          portalUsername?: string | null
          propertyId?: string | null
          providerName?: string | null
          recurrenceMonths?: number | null
          referenceNumber?: string | null
          source?: string | null
          sourceFileData?: string | null
          sourceFileName?: string | null
          status?: string
          taxCategory?: string | null
          tenantRebillStatus?: string | null
        }
        Update: {
          amount?: number
          assetId?: string | null
          billGroupId?: string | null
          billType?: string
          bpayBillerCode?: string | null
          bpayReference?: string | null
          category?: string | null
          created_at?: string
          dueDate?: string
          emailMessageId?: string | null
          id?: string
          issueDate?: string | null
          label?: string | null
          lineItems?: Json | null
          linkedExpenseId?: string | null
          notes?: string | null
          paidDate?: string | null
          passwordNote?: string | null
          periodEnd?: string | null
          periodStart?: string | null
          portalUrl?: string | null
          portalUsername?: string | null
          propertyId?: string | null
          providerName?: string | null
          recurrenceMonths?: number | null
          referenceNumber?: string | null
          source?: string | null
          sourceFileData?: string | null
          sourceFileName?: string | null
          status?: string
          taxCategory?: string | null
          tenantRebillStatus?: string | null
        }
        Relationships: []
      }
      providers: {
        Row: {
          abn: string | null
          address: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          passwordNote: string | null
          phone: string | null
          portalUrl: string | null
          portalUsername: string | null
          propertyId: string | null
          role: string
          website: string | null
        }
        Insert: {
          abn?: string | null
          address?: string | null
          created_at?: string
          email?: string | null
          id: string
          name: string
          notes?: string | null
          passwordNote?: string | null
          phone?: string | null
          portalUrl?: string | null
          portalUsername?: string | null
          propertyId?: string | null
          role?: string
          website?: string | null
        }
        Update: {
          abn?: string | null
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          passwordNote?: string | null
          phone?: string | null
          portalUrl?: string | null
          portalUsername?: string | null
          propertyId?: string | null
          role?: string
          website?: string | null
        }
        Relationships: []
      }
      rent_changes: {
        Row: {
          changeDate: string
          created_at: string
          id: string
          newRent: number
          oldRent: number
          tenantId: string
        }
        Insert: {
          changeDate?: string
          created_at?: string
          id: string
          newRent?: number
          oldRent?: number
          tenantId: string
        }
        Update: {
          changeDate?: string
          created_at?: string
          id?: string
          newRent?: number
          oldRent?: number
          tenantId?: string
        }
        Relationships: []
      }
      tenant_invoices: {
        Row: {
          amountDue: number
          chargeType: string
          created_at: string
          dateIssued: string
          description: string | null
          dueDate: string
          id: string
          status: string
          tenantId: string
        }
        Insert: {
          amountDue?: number
          chargeType?: string
          created_at?: string
          dateIssued?: string
          description?: string | null
          dueDate?: string
          id: string
          status?: string
          tenantId: string
        }
        Update: {
          amountDue?: number
          chargeType?: string
          created_at?: string
          dateIssued?: string
          description?: string | null
          dueDate?: string
          id?: string
          status?: string
          tenantId?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          additionalLeaseTerms: string | null
          additionalTenants: Json | null
          bankAccountHolder: string | null
          bankReference: string | null
          bondAmount: number | null
          bondLodgementDate: string | null
          bondPaidTo: string | null
          bondReceiptNumber: string | null
          bondTransferFileData: string | null
          bondTransferFileName: string | null
          created_at: string
          email: string | null
          emergencyContact: string | null
          emergencyContactName: string | null
          emergencyContactPhone: string | null
          emergencyContactRelationship: string | null
          id: string
          idProofFileData: string | null
          idProofFileName: string | null
          landlordConsentsToElectronicService: boolean | null
          lastRentIncreaseDate: string | null
          leaseDocumentFileData: string | null
          leaseDocumentFileName: string | null
          leaseDuration: string | null
          leaseExpiry: string | null
          leaseStart: string | null
          name: string
          noticePeriod: string | null
          paidUpToDate: string
          permanentAddress: string | null
          petsAllowed: boolean | null
          petsDescription: string | null
          phone: string | null
          propertyId: string
          rentAmount: number
          rentFrequency: string
          tenantConsentsToElectronicService: boolean | null
          unitAddress: string | null
        }
        Insert: {
          additionalLeaseTerms?: string | null
          additionalTenants?: Json | null
          bankAccountHolder?: string | null
          bankReference?: string | null
          bondAmount?: number | null
          bondLodgementDate?: string | null
          bondPaidTo?: string | null
          bondReceiptNumber?: string | null
          bondTransferFileData?: string | null
          bondTransferFileName?: string | null
          created_at?: string
          email?: string | null
          emergencyContact?: string | null
          emergencyContactName?: string | null
          emergencyContactPhone?: string | null
          emergencyContactRelationship?: string | null
          id: string
          idProofFileData?: string | null
          idProofFileName?: string | null
          landlordConsentsToElectronicService?: boolean | null
          lastRentIncreaseDate?: string | null
          leaseDocumentFileData?: string | null
          leaseDocumentFileName?: string | null
          leaseDuration?: string | null
          leaseExpiry?: string | null
          leaseStart?: string | null
          name?: string
          noticePeriod?: string | null
          paidUpToDate?: string
          permanentAddress?: string | null
          petsAllowed?: boolean | null
          petsDescription?: string | null
          phone?: string | null
          propertyId: string
          rentAmount?: number
          rentFrequency?: string
          tenantConsentsToElectronicService?: boolean | null
          unitAddress?: string | null
        }
        Update: {
          additionalLeaseTerms?: string | null
          additionalTenants?: Json | null
          bankAccountHolder?: string | null
          bankReference?: string | null
          bondAmount?: number | null
          bondLodgementDate?: string | null
          bondPaidTo?: string | null
          bondReceiptNumber?: string | null
          bondTransferFileData?: string | null
          bondTransferFileName?: string | null
          created_at?: string
          email?: string | null
          emergencyContact?: string | null
          emergencyContactName?: string | null
          emergencyContactPhone?: string | null
          emergencyContactRelationship?: string | null
          id?: string
          idProofFileData?: string | null
          idProofFileName?: string | null
          landlordConsentsToElectronicService?: boolean | null
          lastRentIncreaseDate?: string | null
          leaseDocumentFileData?: string | null
          leaseDocumentFileName?: string | null
          leaseDuration?: string | null
          leaseExpiry?: string | null
          leaseStart?: string | null
          name?: string
          noticePeriod?: string | null
          paidUpToDate?: string
          permanentAddress?: string | null
          petsAllowed?: boolean | null
          petsDescription?: string | null
          phone?: string | null
          propertyId?: string
          rentAmount?: number
          rentFrequency?: string
          tenantConsentsToElectronicService?: boolean | null
          unitAddress?: string | null
        }
        Relationships: []
      }
      valuation_snapshots: {
        Row: {
          assetId: string
          created_at: string
          date: string
          id: string
          value: number
        }
        Insert: {
          assetId: string
          created_at?: string
          date: string
          id: string
          value: number
        }
        Update: {
          assetId?: string
          created_at?: string
          date?: string
          id?: string
          value?: number
        }
        Relationships: []
      }
    }
    Views: {
      properties_public: {
        Row: {
          address: string | null
          alias: string | null
          id: string | null
          tenantCode: string | null
        }
        Insert: {
          address?: string | null
          alias?: string | null
          id?: string | null
          tenantCode?: string | null
        }
        Update: {
          address?: string | null
          alias?: string | null
          id?: string | null
          tenantCode?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
