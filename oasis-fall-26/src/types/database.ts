
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "buildings": {
                  Row: {
                    "address": string | null,"amenities": (string)[],"heat_ac": string | null,"id": number,"latitude": number | null,"laundry": string | null,"longitude": number | null,"management_company": string | null,"name": string,"neighborhood": string,"rent_range": string | null,"sources": NonNullable<Json>,"summary": string | null,"updated_at": string,"walk_minutes_to_campus": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"amenities"?: (string)[],"heat_ac"?: string | null,"id"?: never,"latitude"?: number | null,"laundry"?: string | null,"longitude"?: number | null,"management_company"?: string | null,"name": string,"neighborhood": string,"rent_range"?: string | null,"sources"?: NonNullable<Json>,"summary"?: string | null,"updated_at"?: string,"walk_minutes_to_campus"?: number | null
                  }
                  Update: {
                    "address"?: string | null,"amenities"?: (string)[],"heat_ac"?: string | null,"id"?: never,"latitude"?: number | null,"laundry"?: string | null,"longitude"?: number | null,"management_company"?: string | null,"name"?: string,"neighborhood"?: string,"rent_range"?: string | null,"sources"?: NonNullable<Json>,"summary"?: string | null,"updated_at"?: string,"walk_minutes_to_campus"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"lifestyle": {
                  Row: {
                    "cleanliness": number | null,"dealbreakers": (string)[],"guests": number | null,"has_pets": boolean | null,"noise": number | null,"sleep": number | null,"smokes": boolean | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cleanliness"?: number | null,"dealbreakers"?: (string)[],"guests"?: number | null,"has_pets"?: boolean | null,"noise"?: number | null,"sleep"?: number | null,"smokes"?: boolean | null,"user_id": string
                  }
                  Update: {
                    "cleanliness"?: number | null,"dealbreakers"?: (string)[],"guests"?: number | null,"has_pets"?: boolean | null,"noise"?: number | null,"sleep"?: number | null,"smokes"?: boolean | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lifestyle_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"listing_photos": {
                  Row: {
                    "created_at": string,"id": number,"listing_id": number,"path": string,"position": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"listing_id": number,"path": string,"position": number
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"listing_id"?: number,"path"?: string,"position"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "listing_photos_listing_id_fkey"
      columns: ["listing_id"]
isOneToOne: false
      referencedRelation: "listings"
      referencedColumns: ["id"]
    }
                  ]
                },"listing_roommates": {
                  Row: {
                    "created_at": string,"display_name": string,"id": number,"listing_id": number,"note": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"id"?: never,"listing_id": number,"note"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"id"?: never,"listing_id"?: number,"note"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "listing_roommates_listing_id_fkey"
      columns: ["listing_id"]
isOneToOne: false
      referencedRelation: "listings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "listing_roommates_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"listings": {
                  Row: {
                    "building_id": number | null,"created_at": string,"description": string | null,"end_date": string,"fill_by": string,"furnished": boolean,"id": number,"neighborhood": string,"open_rooms": number,"owner_id": string,"rent_per_room": number,"start_date": string,"status": Database["public"]['Enums']["listing_status"],"title": string,"total_bedrooms": number,"updated_at": string,"utilities_included": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: number | null,"created_at"?: string,"description"?: string | null,"end_date": string,"fill_by": string,"furnished"?: boolean,"id"?: never,"neighborhood": string,"open_rooms": number,"owner_id": string,"rent_per_room": number,"start_date": string,"status"?: Database["public"]['Enums']["listing_status"],"title": string,"total_bedrooms": number,"updated_at"?: string,"utilities_included"?: boolean
                  }
                  Update: {
                    "building_id"?: number | null,"created_at"?: string,"description"?: string | null,"end_date"?: string,"fill_by"?: string,"furnished"?: boolean,"id"?: never,"neighborhood"?: string,"open_rooms"?: number,"owner_id"?: string,"rent_per_room"?: number,"start_date"?: string,"status"?: Database["public"]['Enums']["listing_status"],"title"?: string,"total_bedrooms"?: number,"updated_at"?: string,"utilities_included"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "listings_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "listings_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "bio": string | null,"created_at": string,"email": string | null,"full_name": string,"id": string,"major": string | null,"school": string,"year": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bio"?: string | null,"created_at"?: string,"email"?: string | null,"full_name": string,"id": string,"major"?: string | null,"school"?: string,"year"?: string | null
                  }
                  Update: {
                    "bio"?: string | null,"created_at"?: string,"email"?: string | null,"full_name"?: string,"id"?: string,"major"?: string | null,"school"?: string,"year"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"reports": {
                  Row: {
                    "created_at": string,"id": number,"listing_id": number,"note": string | null,"reason": Database["public"]['Enums']["report_reason"],"reporter_id": string | null,"resolved_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"listing_id": number,"note"?: string | null,"reason": Database["public"]['Enums']["report_reason"],"reporter_id"?: string | null,"resolved_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"listing_id"?: number,"note"?: string | null,"reason"?: Database["public"]['Enums']["report_reason"],"reporter_id"?: string | null,"resolved_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_listing_id_fkey"
      columns: ["listing_id"]
isOneToOne: false
      referencedRelation: "listings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"seeker_posts": {
                  Row: {
                    "budget_max": number,"created_at": string,"end_date": string,"id": number,"neighborhoods": (string)[],"note": string | null,"reason": Database["public"]['Enums']["seeker_reason"],"start_date": string,"status": Database["public"]['Enums']["seeker_status"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "budget_max": number,"created_at"?: string,"end_date": string,"id"?: never,"neighborhoods"?: (string)[],"note"?: string | null,"reason": Database["public"]['Enums']["seeker_reason"],"start_date": string,"status"?: Database["public"]['Enums']["seeker_status"],"user_id": string
                  }
                  Update: {
                    "budget_max"?: number,"created_at"?: string,"end_date"?: string,"id"?: never,"neighborhoods"?: (string)[],"note"?: string | null,"reason"?: Database["public"]['Enums']["seeker_reason"],"start_date"?: string,"status"?: Database["public"]['Enums']["seeker_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "seeker_posts_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "expire_stale_posts":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"match_listings_for_seeker":
{ Args: { "p_seeker_post": number }; Returns: {
              "listing_id": number,"score": number
            }[]
                           },
"match_score":
{ Args: { "budget_max": number,"listing_end": string,"listing_neighborhood": string,"listing_start": string,"rent_per_room": number,"seeker_end": string,"seeker_neighborhoods": (string)[],"seeker_start": string }; Returns: number
                           },
"match_seekers_for_listing":
{ Args: { "p_listing": number }; Returns: {
              "score": number,"seeker_post_id": number
            }[]
                           }
          }
          Enums: {
            "listing_status": "open"|"filled"|"closed","report_reason": "out_of_date"|"other","seeker_reason": "co_op"|"summer_classes"|"internship"|"other","seeker_status": "active"|"paused"|"housed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "listing_status": ["open", "filled", "closed"],"report_reason": ["out_of_date", "other"],"seeker_reason": ["co_op", "summer_classes", "internship", "other"],"seeker_status": ["active", "paused", "housed"]
          }
        }
} as const
