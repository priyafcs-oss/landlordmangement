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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          aiConfig: Json
          id: string
          landlordProfile: Json
          updated_at: string
        }
        Insert: {
          aiConfig?: Json
          id: string
          landlordProfile?: Json
          updated_at?: string
        }
        Update: {
          aiConfig?: Json
          id?: string
          landlordProfile?: Json
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          cost: number
          created_at: string
          date: string
          hasWarranty: boolean
          id: string
          invoiceFileData: string | null
          invoiceFileName: string | null
          itemName: string
          propertyId: string
          rechargeToTenant: boolean
          taxCategory: string
          tenantId: string | null
          warrantyExpiry: string | null
        }
        Insert: {
          cost?: number
          created_at?: string
          date?: string
          hasWarranty?: boolean
          id: string
          invoiceFileData?: string | null
          invoiceFileName?: string | null
          itemName?: string
          propertyId: string
          rechargeToTenant?: boolean
          taxCategory?: string
          tenantId?: string | null
          warrantyExpiry?: string | null
        }
        Update: {
          cost?: number
          created_at?: string
          date?: string
          hasWarranty?: boolean
          id?: string
          invoiceFileData?: string | null
          invoiceFileName?: string | null
          itemName?: string
          propertyId?: string
          rechargeToTenant?: boolean
          taxCategory?: string
          tenantId?: string | null
          warrantyExpiry?: string | null
        }
        Relationships: []
      }
      inspections: {
        Row: {
          checklist: Json | null
          created_at: string
          date: string
          fileData: string | null
          fileFileName: string | null
          id: string
          notes: string | null
          photos: Json | null
          propertyId: string
          rooms: Json | null
          signature: string | null
          status: string
          type: string
        }
        Insert: {
          checklist?: Json | null
          created_at?: string
          date?: string
          fileData?: string | null
          fileFileName?: string | null
          id: string
          notes?: string | null
          photos?: Json | null
          propertyId: string
          rooms?: Json | null
          signature?: string | null
          status?: string
          type?: string
        }
        Update: {
          checklist?: Json | null
          created_at?: string
          date?: string
          fileData?: string | null
          fileFileName?: string | null
          id?: string
          notes?: string | null
          photos?: Json | null
          propertyId?: string
          rooms?: Json | null
          signature?: string | null
          status?: string
          type?: string
        }
        Relationships: []
      }
      lease_history: {
        Row: {
          created_at: string
          id: string
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
          tenantId?: string
          type?: string
        }
        Relationships: []
      }
      loans: {
        Row: {
          bankName: string
          created_at: string
          dueDayOfMonth: number | null
          id: string
          interestRate: number
          isDirectDebit: boolean | null
          linkedBankAccount: string | null
          monthlyEmi: number
          propertyId: string
          status: string | null
          totalBalance: number
        }
        Insert: {
          bankName?: string
          created_at?: string
          dueDayOfMonth?: number | null
          id: string
          interestRate?: number
          isDirectDebit?: boolean | null
          linkedBankAccount?: string | null
          monthlyEmi?: number
          propertyId: string
          status?: string | null
          totalBalance?: number
        }
        Update: {
          bankName?: string
          created_at?: string
          dueDayOfMonth?: number | null
          id?: string
          interestRate?: number
          isDirectDebit?: boolean | null
          linkedBankAccount?: string | null
          monthlyEmi?: number
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
          created_at: string
          currentValue: number
          id: string
          interestRate: number | null
          lender: string | null
          loanAccountRef: string | null
          loanBalance: number | null
          purchaseDate: string | null
          purchasePrice: number
          repaymentFrequency: string | null
          tenantCode: string | null
        }
        Insert: {
          address?: string
          created_at?: string
          currentValue?: number
          id: string
          interestRate?: number | null
          lender?: string | null
          loanAccountRef?: string | null
          loanBalance?: number | null
          purchaseDate?: string | null
          purchasePrice?: number
          repaymentFrequency?: string | null
          tenantCode?: string | null
        }
        Update: {
          address?: string
          created_at?: string
          currentValue?: number
          id?: string
          interestRate?: number | null
          lender?: string | null
          loanAccountRef?: string | null
          loanBalance?: number | null
          purchaseDate?: string | null
          purchasePrice?: number
          repaymentFrequency?: string | null
          tenantCode?: string | null
        }
        Relationships: []
      }
      property_bills: {
        Row: {
          amount: number
          billType: string
          created_at: string
          dueDate: string
          id: string
          notes: string | null
          paidDate: string | null
          passwordNote: string | null
          portalUrl: string | null
          portalUsername: string | null
          propertyId: string
          recurrenceMonths: number | null
          status: string
        }
        Insert: {
          amount?: number
          billType?: string
          created_at?: string
          dueDate?: string
          id: string
          notes?: string | null
          paidDate?: string | null
          passwordNote?: string | null
          portalUrl?: string | null
          portalUsername?: string | null
          propertyId: string
          recurrenceMonths?: number | null
          status?: string
        }
        Update: {
          amount?: number
          billType?: string
          created_at?: string
          dueDate?: string
          id?: string
          notes?: string | null
          paidDate?: string | null
          passwordNote?: string | null
          portalUrl?: string | null
          portalUsername?: string | null
          propertyId?: string
          recurrenceMonths?: number | null
          status?: string
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
          bankAccountHolder: string | null
          bankReference: string | null
          bondAmount: number | null
          bondLodgementDate: string | null
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
          phone: string | null
          propertyId: string
          rentAmount: number
          rentFrequency: string
        }
        Insert: {
          bankAccountHolder?: string | null
          bankReference?: string | null
          bondAmount?: number | null
          bondLodgementDate?: string | null
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
          phone?: string | null
          propertyId: string
          rentAmount?: number
          rentFrequency?: string
        }
        Update: {
          bankAccountHolder?: string | null
          bankReference?: string | null
          bondAmount?: number | null
          bondLodgementDate?: string | null
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
          phone?: string | null
          propertyId?: string
          rentAmount?: number
          rentFrequency?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
