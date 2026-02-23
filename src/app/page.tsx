"use client"

import { Button } from "@/components/ui/button"
import { useTRPC } from "@/trpc/client"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

const Page = () => {

  const trpc = useTRPC()
  const invoke = useMutation(trpc.invoke.mutationOptions({
    onSuccess:()=>{
      toast.success("Invoked")
    }
  }))

  return (
    <div>
      <Button disabled={invoke.isPending} onClick={()=> invoke.mutate({text: "Hello, World!"	})}>Invoke</Button>
    </div>
  )
}

export default Page
