"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session-provider";

export default function HomePage() {
  const { session, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) {
      return;
    }
    router.replace(session ? "/dashboard" : "/login");
  }, [loading, session, router]);

  return null;
}
