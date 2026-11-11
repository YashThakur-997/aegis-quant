from typing import TypedDict, Literal, List
from pydantic import BaseModel, Field
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END
import os

class TradeSignal(BaseModel):
    """
    Structured Pydantic trade signal outputted by the Judge Agent,
    feeding cleanly into the deterministic risk engine without math hallucinations[cite: 3, 4].
    """
    direction: Literal["BUY", "SELL", "HOLD"] = Field(description="Recommended trading action based on adversarial debate.")
    conviction: float = Field(description="Confidence score between 0.0 and 1.0.")
    bull_catalysts: List[str] = Field(default_factory=list, description="Key upside catalysts extracted by the Bull Agent.")
    bear_risks: List[str] = Field(default_factory=list, description="Key downside risks and market divergences extracted by the Bear Agent.")
    plain_language_reasoning: str = Field(description="Immutable plain-language thesis explaining the trade rationale for the audit journal.")
    citations: List[str] = Field(default_factory=list, description="News sources and market data citations supporting the decision[cite: 3].")

class DebateState(TypedDict):
    """State graph structure tracking the multi-agent debate lifecycle."""
    anonymized_data: str
    news_summary: str
    bull_thesis: str
    bear_thesis: str
    final_signal: TradeSignal

# Initialize Groq LLM with high-speed Llama-3.3-70B-versatile model[cite: 3, 7]
llm = ChatGroq(
    model_name="openai/gpt-oss-120b",
    temperature=0.2,
    api_key=os.getenv("GROQ_API_KEY")
)

def bull_agent_node(state: DebateState) -> dict:
    """
    Bull Agent: Extracts growth catalysts, positive momentum, and upside potential
    from the anonymized market tensors and financial news feed[cite: 3, 4].
    """
    system_prompt = (
        "You are an aggressive Bullish Trading Agent. Your goal is to analyze the anonymized "
        "market data and news feed to extract strong upside catalysts and long/buy theses[cite: 3, 4]."
    )
    user_prompt = (
        f"Anonymized Market Data:\n{state['anonymized_data']}\n\n"
        f"Financial News Summary:\n{state['news_summary']}\n\n"
        "Provide a concise, hard-hitting bull thesis with supporting points."
    )
    
    response = llm.invoke([("system", system_prompt), ("user", user_prompt)])
    return {"bull_thesis": response.content}

def bear_agent_node(state: DebateState) -> dict:
    """
    Bear Agent: Scrutinizes the bull thesis, identifies macro/technical risks,
    high volatility, and potential market divergences[cite: 3, 4].
    """
    system_prompt = (
        "You are a conservative Bearish Risk Agent. Your goal is to critically examine the "
        "market data, news, and the Bull's thesis to highlight severe risk factors, downside "
        "vulnerabilities, and counter-arguments[cite: 3, 4]."
    )
    user_prompt = (
        f"Anonymized Market Data:\n{state['anonymized_data']}\n"
        f"Financial News Summary:\n{state['news_summary']}\n\n"
        f"Bull Thesis Presented:\n{state['bull_thesis']}\n\n"
        "Critique the bull thesis, identify hidden risks, and present your bear case."
    )
    
    response = llm.invoke([("system", system_prompt), ("user", user_prompt)])
    return {"bear_thesis": response.content}

def judge_agent_node(state: DebateState) -> dict:
    """
    Judge Agent: Weighs the adversarial arguments and outputs a strict 
    Pydantic TradeSignal for downstream deterministic execution[cite: 3, 4].
    """
    structured_llm = llm.with_structured_output(TradeSignal)
    
    system_prompt = (
        "You are the Chief Risk Officer and Judge. Evaluate the adversarial debate between "
        "the Bull and Bear agents impartially. Issue a final, structured trading decision[cite: 3, 4]."
    )
    user_prompt = (
        f"Bull Thesis: {state['bull_thesis']}\n\n"
        f"Bear Thesis: {state['bear_thesis']}\n\n"
        "Weigh the risk-to-reward ratio and output the final structured trade signal."
    )
    
    signal = structured_llm.invoke([("system", system_prompt), ("user", user_prompt)])
    if not isinstance(signal, TradeSignal):
        signal = TradeSignal(**signal)
    return {"final_signal": signal}

# Construct the LangGraph State Machine Workflow[cite: 3, 7]
workflow = StateGraph(DebateState)

workflow.add_node("bull_agent", bull_agent_node)
workflow.add_node("bear_agent", bear_agent_node)
workflow.add_node("judge_agent", judge_agent_node)

workflow.set_entry_point("bull_agent")
workflow.add_edge("bull_agent", "bear_agent")
workflow.add_edge("bear_agent", "judge_agent")
workflow.add_edge("judge_agent", END)

# Compile the graph into an executable app
debate_workflow = workflow.compile()