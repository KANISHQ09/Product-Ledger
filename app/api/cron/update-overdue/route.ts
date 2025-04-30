import { NextResponse } from "next/server"
import { connectToDatabase, collections, isOverdue } from "@/lib/db"
import { ObjectId } from "mongodb"

// This route is meant to be called by a cron job to update overdue status
export async function GET(request: Request) {
  try {
    // Check for a secret key to secure the endpoint
    const { searchParams } = new URL(request.url)
    const secretKey = searchParams.get("key")

    if (secretKey !== process.env.CRON_SECRET_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { db } = await connectToDatabase()

    // Get all unpaid ledger entries
    const unpaidEntries = (await db
      .collection(collections.ledger)
      .find({
        status: "Unpaid",
        type: "Sell",
      })
      .toArray()) as unknown as { customerId: string; date: Date; _id: string }[]

    // Get customer settings for grace period
    const customerSettings = await db.collection(collections.customerSettings).find({}).toArray()

    // Create a map of customer settings for quick lookup
    const settingsMap = new Map()
    customerSettings.forEach((setting: { customerId: string; gracePeriod?: number }) => {
      const typedSetting = setting
      settingsMap.set(typedSetting.customerId.toString(), typedSetting)
    })

    // Default grace period if no settings found
    const defaultGracePeriod = 30

    // Count of updated entries
    let updatedCount = 0

    // Update entries that are overdue
    const updatePromises = unpaidEntries.map(async (entry: { customerId: string; date: Date; _id: string }) => {
      const customerSetting = settingsMap.get(entry.customerId.toString())
      const gracePeriod = customerSetting ? customerSetting.gracePeriod : defaultGracePeriod

      if (isOverdue(entry.date, gracePeriod)) {
        await db
          .collection(collections.ledger)
          .updateOne({ _id: new ObjectId(entry._id) }, { $set: { status: "Overdue", updatedAt: new Date() } })
        updatedCount++
      }
    })

    await Promise.all(updatePromises)

    return NextResponse.json({
      success: true,
      message: `Updated ${updatedCount} entries to overdue status`,
    })
  } catch (error) {
    console.error("Failed to update overdue status:", error)
    return NextResponse.json({ error: "Failed to update overdue status" }, { status: 500 })
  }
}