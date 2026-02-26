"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTRPC } from "@/trpc/client"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

const Page = () => {

  const [value,setValue] = useState("")

  const trpc = useTRPC()
  const invoke = useMutation(trpc.invoke.mutationOptions({
    onSuccess:()=>{
      toast.success("Invoked")
    }
  }))

  return (
    <div>
      <Input value={value} onChange={(e)=> setValue(e.target.value)}/>
      <Button disabled={invoke.isPending} onClick={()=> invoke.mutate({value: value	})}>Invoke</Button>
    </div>
  )
}

export default Page
